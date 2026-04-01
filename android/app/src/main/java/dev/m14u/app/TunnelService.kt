package dev.m14u.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.getcapacitor.JSObject
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class TunnelService : Service() {

    companion object {
        private const val TAG = "TunnelService"
        private const val CHANNEL_ID = "m14u_tunnel"
        private const val NOTIFICATION_ID = 1
        private const val KV_BASE = "https://m14u.sanpro.workers.dev/"
        private const val DEFAULT_PORT = 8080
        private const val MAX_CONSECUTIVE_ERRORS = 5
        private const val ERROR_WINDOW_MS = 30_000L
        private const val MAX_RESTART_ATTEMPTS = 3

        @Volatile
        var instance: TunnelService? = null
            private set
    }

    interface EventListener {
        fun onTunnelLog(event: JSObject)
        fun onTunnelPanic(event: JSObject)
    }

    var eventListener: EventListener? = null
    var currentTunnelUrl: String? = null
        private set

    private var tunnelProcess: Process? = null
    private var roomServer: RoomHttpServer? = null
    private var currentUsername: String? = null
    private var currentPort: Int = DEFAULT_PORT
    private var isRestarting: Boolean = false
    private var consecutiveErrors: Int = 0
    private var lastErrorTime: Long = 0
    private var restartAttempts: Int = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private var drainJob: Job? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val username = intent?.getStringExtra("username") ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        val port = intent.getIntExtra("port", DEFAULT_PORT)

        currentUsername = username
        currentPort = port
        restartAttempts = 0

        acquireWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification("Starting tunnel..."))

        CoroutineScope(Dispatchers.IO).launch {
            startTunnelInternal(username, port)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopInternal()
        releaseWakeLock()
        instance = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "M14U Tunnel",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the cloudflared tunnel alive in the background"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("M14U Tunnel")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "m14u::tunnel").apply {
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    // --- Public API for plugin ---

    fun updateRoomState(json: String) {
        roomServer?.pushState(json)
    }

    // --- Tunnel logic ---

    private fun startTunnelInternal(username: String, port: Int) {
        try {
            stopInternal()

            roomServer = RoomHttpServer(port, username).also { it.start() }
            Log.d(TAG, "Room HTTP server started on port $port")

            val nativeDir = applicationInfo.nativeLibraryDir
            val binary = "$nativeDir/libcloudflared.so"

            val pb = ProcessBuilder(binary, "tunnel", "--url", "http://localhost:$port")
            pb.redirectErrorStream(true)
            val process = pb.start()
            tunnelProcess = process

            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val anyUrlRegex = Regex("""https?://[^\s)]+""")
            var line: String?
            var tunnelUrl: String? = null

            while (reader.readLine().also { line = it } != null) {
                Log.d(TAG, "cloudflared: $line")
                val logEvent = parseCloudflaredLog(line ?: "")
                eventListener?.onTunnelLog(logEvent)

                val match = anyUrlRegex.find(line ?: "")
                val candidate = match?.value?.trim()
                if (candidate != null && tunnelUrl == null
                    && candidate.endsWith("trycloudflare.com")
                    && candidate != "https://api.trycloudflare.com"
                ) {
                    tunnelUrl = candidate
                    currentTunnelUrl = tunnelUrl
                    Log.d(TAG, "Tunnel URL: $tunnelUrl")
                    updateKV(username, tunnelUrl)
                    updateNotification("Tunnel: $tunnelUrl")
                    break
                }
            }

            if (tunnelUrl == null) {
                Log.e(TAG, "cloudflared exited without producing a URL")
                updateNotification("Tunnel failed to start")
                return
            }

            drainJob = CoroutineScope(Dispatchers.IO).launch {
                try {
                    while (reader.readLine().also { line = it } != null) {
                        Log.d(TAG, "cloudflared: $line")
                        val logEvent = parseCloudflaredLog(line ?: "")
                        eventListener?.onTunnelLog(logEvent)
                        checkPanic(logEvent)
                    }
                    if (!isRestarting) {
                        val exitCode = try { tunnelProcess?.exitValue() } catch (_: Exception) { null }
                        Log.w(TAG, "cloudflared process exited (code=$exitCode)")
                        if (exitCode != null && exitCode != 0) {
                            restartTunnel("process exited with code $exitCode")
                        }
                    }
                } catch (_: Exception) {}
            }
        } catch (e: Exception) {
            Log.e(TAG, "startTunnelInternal failed", e)
            updateNotification("Tunnel error: ${e.message}")
        }
    }

    private fun parseCloudflaredLog(rawLine: String): JSObject {
        val obj = JSObject()
        obj.put("raw", rawLine)

        val logRegex = Regex("""^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(INF|WRN|ERR|DBG|FTL)\s+(.*)$""")
        val match = logRegex.find(rawLine)
        if (match != null) {
            val (timestamp, level, rest) = match.destructured
            obj.put("timestamp", timestamp)
            obj.put("level", when (level) {
                "INF" -> "info"
                "WRN" -> "warn"
                "ERR" -> "error"
                "DBG" -> "debug"
                "FTL" -> "fatal"
                else -> level.lowercase()
            })

            val kvRegex = Regex("""(\w+)=("(?:[^"\\]|\\.)*"|\S+)""")
            val kvMatches = kvRegex.findAll(rest).toList()
            val fields = JSObject()
            var message = rest

            if (kvMatches.isNotEmpty()) {
                val firstKvStart = kvMatches.first().range.first
                message = rest.substring(0, firstKvStart).trim()
                for (kv in kvMatches) {
                    val key = kv.groupValues[1]
                    var value = kv.groupValues[2]
                    if (value.startsWith("\"") && value.endsWith("\"")) {
                        value = value.substring(1, value.length - 1)
                    }
                    fields.put(key, value)
                }
            }

            obj.put("message", message)
            if (fields.length() > 0) {
                obj.put("fields", fields)
            }
        } else {
            obj.put("level", "info")
            obj.put("message", rawLine)
        }

        return obj
    }

    private fun checkPanic(logEvent: JSObject) {
        val level = logEvent.optString("level", "info")
        val message = logEvent.optString("message", "")

        when (level) {
            "fatal" -> {
                Log.e(TAG, "PANIC: fatal log detected — $message")
                restartTunnel("fatal log: $message")
            }
            "error" -> {
                val now = System.currentTimeMillis()
                if (now - lastErrorTime > ERROR_WINDOW_MS) {
                    consecutiveErrors = 0
                }
                consecutiveErrors++
                lastErrorTime = now
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    Log.e(TAG, "PANIC: $consecutiveErrors consecutive errors within ${ERROR_WINDOW_MS}ms")
                    restartTunnel("$consecutiveErrors consecutive errors")
                }
            }
            "info" -> {
                if (message.contains("Registered tunnel connection", ignoreCase = true)) {
                    consecutiveErrors = 0
                    restartAttempts = 0
                }
            }
        }
    }

    private fun restartTunnel(reason: String) {
        if (isRestarting) return
        val username = currentUsername ?: return
        val port = currentPort

        restartAttempts++
        if (restartAttempts > MAX_RESTART_ATTEMPTS) {
            Log.e(TAG, "PANIC: giving up after $MAX_RESTART_ATTEMPTS restart attempts")
            val event = JSObject().apply {
                put("type", "failed")
                put("attempt", restartAttempts - 1)
                put("reason", reason)
            }
            eventListener?.onTunnelPanic(event)
            updateNotification("Tunnel failed permanently")
            return
        }

        isRestarting = true
        consecutiveErrors = 0

        Log.w(TAG, "PANIC: restarting tunnel (attempt $restartAttempts, reason: $reason)")
        val restartEvent = JSObject().apply {
            put("type", "restarting")
            put("attempt", restartAttempts)
            put("reason", reason)
        }
        eventListener?.onTunnelPanic(restartEvent)
        updateNotification("Restarting tunnel (attempt $restartAttempts)...")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                stopInternal()

                roomServer = RoomHttpServer(port, username).also { it.start() }

                val nativeDir = applicationInfo.nativeLibraryDir
                val binary = "$nativeDir/libcloudflared.so"
                val pb = ProcessBuilder(binary, "tunnel", "--url", "http://localhost:$port")
                pb.redirectErrorStream(true)
                val process = pb.start()
                tunnelProcess = process

                val reader = BufferedReader(InputStreamReader(process.inputStream))
                val anyUrlRegex = Regex("""https?://[^\s)]+""")
                var line: String?
                var tunnelUrl: String? = null
                var resolved = false

                while (reader.readLine().also { line = it } != null) {
                    Log.d(TAG, "cloudflared(restart): $line")
                    val logEvent = parseCloudflaredLog(line ?: "")
                    eventListener?.onTunnelLog(logEvent)

                    val match = anyUrlRegex.find(line ?: "")
                    val candidate = match?.value?.trim()
                    if (candidate != null && tunnelUrl == null
                        && candidate.endsWith("trycloudflare.com")
                        && candidate != "https://api.trycloudflare.com"
                    ) {
                        tunnelUrl = candidate
                        currentTunnelUrl = tunnelUrl
                        updateKV(username, tunnelUrl)
                        resolved = true
                        break
                    }
                }

                isRestarting = false

                if (resolved && tunnelUrl != null) {
                    Log.i(TAG, "PANIC: tunnel restarted successfully → $tunnelUrl")
                    val event = JSObject().apply {
                        put("type", "restarted")
                        put("attempt", restartAttempts)
                        put("newUrl", tunnelUrl)
                        put("reason", reason)
                    }
                    eventListener?.onTunnelPanic(event)
                    updateNotification("Tunnel: $tunnelUrl")

                    drainJob = CoroutineScope(Dispatchers.IO).launch {
                        try {
                            while (reader.readLine().also { line = it } != null) {
                                Log.d(TAG, "cloudflared: $line")
                                val logEvent = parseCloudflaredLog(line ?: "")
                                eventListener?.onTunnelLog(logEvent)
                                checkPanic(logEvent)
                            }
                            if (!isRestarting) {
                                val exitCode = try { tunnelProcess?.exitValue() } catch (_: Exception) { null }
                                if (exitCode != null && exitCode != 0) {
                                    restartTunnel("process exited with code $exitCode")
                                }
                            }
                        } catch (_: Exception) {}
                    }
                } else {
                    Log.e(TAG, "PANIC: restart failed — no tunnel URL obtained")
                    restartTunnel(reason)
                }
            } catch (e: Exception) {
                Log.e(TAG, "PANIC: restart exception", e)
                isRestarting = false
                restartTunnel(reason)
            }
        }
    }

    private fun stopInternal() {
        drainJob?.cancel()
        drainJob = null

        tunnelProcess?.let {
            it.destroy()
            Log.d(TAG, "Tunnel process destroyed")
        }
        tunnelProcess = null

        roomServer?.let {
            it.stop()
            Log.d(TAG, "Room HTTP server stopped")
        }
        roomServer = null
    }

    private fun updateKV(username: String, tunnelUrl: String) {
        try {
            val url = "${KV_BASE}?key=${username}&value=${java.net.URLEncoder.encode(tunnelUrl, "UTF-8")}"
            val request = Request.Builder().url(url).build()
            val response = httpClient.newCall(request).execute()
            if (response.isSuccessful) {
                Log.d(TAG, "KV updated: key=$username value=$tunnelUrl")
            } else {
                Log.e(TAG, "KV update failed: HTTP ${response.code}")
            }
            response.close()
        } catch (e: Exception) {
            Log.e(TAG, "KV update failed", e)
        }
    }

    // --- Room HTTP Server (SSE) ---

    class RoomHttpServer(port: Int, private val roomName: String) : NanoHTTPD(port) {

        @Volatile
        var roomStateJson: String = "{}"

        private data class SSEClient(val queue: LinkedBlockingQueue<String>)
        private val clients = CopyOnWriteArrayList<SSEClient>()

        fun pushState(json: String) {
            roomStateJson = json
            val dead = mutableListOf<SSEClient>()
            for (client in clients) {
                try {
                    client.queue.offer(json)
                } catch (_: Exception) {
                    dead.add(client)
                }
            }
            if (dead.isNotEmpty()) clients.removeAll(dead.toSet())
        }

        override fun serve(session: IHTTPSession): Response {
            val uri = session.uri ?: "/"
            val method = session.method

            // CORS preflight
            if (method == Method.OPTIONS) {
                return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "").also {
                    addCorsHeaders(it)
                }
            }

            return when {
                uri == "/" && method == Method.GET -> {
                    val redirectUrl = "https://m14u.pages.dev/room/$roomName"
                    newFixedLengthResponse(Response.Status.REDIRECT, "text/html",
                        "<html><body>Redirecting to <a href=\"$redirectUrl\">$redirectUrl</a></body></html>"
                    ).also {
                        it.addHeader("Location", redirectUrl)
                        addCorsHeaders(it)
                    }
                }
                uri == "/state" && method == Method.GET -> {
                    newFixedLengthResponse(Response.Status.OK, "application/json", roomStateJson).also {
                        addCorsHeaders(it)
                    }
                }
                uri == "/events" && method == Method.GET -> {
                    serveSSE()
                }
                else -> {
                    newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found").also {
                        addCorsHeaders(it)
                    }
                }
            }
        }

        private fun serveSSE(): Response {
            val client = SSEClient(LinkedBlockingQueue())
            clients.add(client)

            // Send current state immediately
            client.queue.offer(roomStateJson)

            val pipedIn = PipedInputStream()
            val pipedOut = PipedOutputStream(pipedIn)

            Thread {
                try {
                    while (true) {
                        val data = client.queue.take() // blocks
                        val sseMessage = "data: $data\n\n"
                        pipedOut.write(sseMessage.toByteArray())
                        pipedOut.flush()
                    }
                } catch (_: Exception) {
                    clients.remove(client)
                    try { pipedOut.close() } catch (_: Exception) {}
                }
            }.start()

            return newChunkedResponse(Response.Status.OK, "text/event-stream", pipedIn).also {
                addCorsHeaders(it)
                it.addHeader("Cache-Control", "no-cache")
                it.addHeader("Connection", "keep-alive")
            }
        }

        private fun addCorsHeaders(response: Response) {
            response.addHeader("Access-Control-Allow-Origin", "*")
            response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
            response.addHeader("Access-Control-Allow-Headers", "*")
        }
    }
}
