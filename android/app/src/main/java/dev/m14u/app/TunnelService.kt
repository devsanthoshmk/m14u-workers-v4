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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
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
        private const val PING_INTERVAL_MS = 99_000L
        private const val CLIENT_TIMEOUT_MS = 120_000L


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
    @Volatile
    var startupGeneration: Long = 0
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
        currentTunnelUrl = null
        startupGeneration += 1

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

    fun updateRoomState(json: String) {
        roomServer?.pushState(json)
    }

    private fun emitTunnelLog(level: String, message: String, raw: String = message) {
        val event = JSObject().apply {
            put("raw", raw)
            put("level", level)
            put("message", message)
        }
        eventListener?.onTunnelLog(event)
    }

    private fun extractTunnelUrl(rawLine: String): String? {
        val match = Regex("""https?://[^\s)]+""").find(rawLine) ?: return null
        val candidate = match.value
            .trim()
            .trimEnd('.', ',', ';')
            .removeSuffix("/")

        return if (
            candidate.startsWith("https://")
            && candidate.endsWith(".trycloudflare.com")
            && candidate != "https://api.trycloudflare.com"
        ) {
            candidate
        } else {
            null
        }
    }

    private fun awaitTunnelUrl(reader: BufferedReader, logPrefix: String): String? {
        var line: String?

        while (reader.readLine().also { line = it } != null) {
            Log.d(TAG, "$logPrefix${line ?: ""}")
            val logEvent = parseCloudflaredLog(line ?: "")
            eventListener?.onTunnelLog(logEvent)

            val candidate = extractTunnelUrl(line ?: "")
            if (candidate != null) {
                return candidate
            }
        }

        return null
    }



    private fun activateTunnel(username: String, tunnelUrl: String) {
        emitTunnelLog("info", "Quick tunnel URL discovered: $tunnelUrl")
        emitTunnelLog("info", "Updating KV for room \"$username\"")

        val kvUpdated = updateKV(username, tunnelUrl)

        currentTunnelUrl = tunnelUrl
        Log.d(TAG, "Tunnel URL ready: $tunnelUrl")

        if (kvUpdated) {
            emitTunnelLog("info", "Tunnel URL published to KV: $tunnelUrl")
        } else {
            emitTunnelLog("warn", "Tunnel URL available but KV update failed: $tunnelUrl")
        }

        updateNotification("Tunnel: $tunnelUrl")
    }

    private fun startTunnelInternal(username: String, port: Int) {
        try {
            stopInternal()
            currentTunnelUrl = null

            emitTunnelLog("info", "Starting local room server on port $port")
            roomServer = RoomHttpServer(port, username).also { it.start() }
            Log.d(TAG, "Room WebSocket server started on port $port")
            emitTunnelLog("info", "Local room server started on port $port")

            val nativeDir = applicationInfo.nativeLibraryDir
            val binary = "$nativeDir/libcloudflared.so"

            emitTunnelLog("info", "Launching cloudflared quick tunnel")
            val pb = ProcessBuilder(binary, "tunnel", "--url", "http://localhost:$port")
            pb.redirectErrorStream(true)
            val process = pb.start()
            tunnelProcess = process

            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?
            val tunnelUrl = awaitTunnelUrl(reader, "cloudflared: ")

            if (tunnelUrl == null) {
                Log.e(TAG, "cloudflared exited without producing a URL")
                updateNotification("Tunnel failed to start")
                emitTunnelLog("error", "cloudflared exited without producing a quick tunnel URL")
                return
            }

            activateTunnel(username, tunnelUrl)

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
                            handleTunnelFailure("process exited with code $exitCode")
                        }
                    }
                } catch (_: Exception) {}
            }

        } catch (e: Exception) {
            Log.e(TAG, "startTunnelInternal failed", e)
            updateNotification("Tunnel error: ${e.message}")
            emitTunnelLog("error", "Tunnel startup failed: ${e.message}")
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
                handleTunnelFailure("fatal log: $message")
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
                    handleTunnelFailure("$consecutiveErrors consecutive errors")
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

    private fun handleTunnelFailure(reason: String) {
        restartTunnel(reason)
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
                currentTunnelUrl = null
                var line: String?
                val tunnelUrl = awaitTunnelUrl(reader, "cloudflared(restart): ")

                isRestarting = false

                if (tunnelUrl != null) {
                    activateTunnel(username, tunnelUrl)
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
        currentTunnelUrl = null

        tunnelProcess?.let {
            it.destroy()
            Log.d(TAG, "Tunnel process destroyed")
        }
        tunnelProcess = null

        roomServer?.stop()
        roomServer = null
    }

    private fun updateKV(username: String, tunnelUrl: String): Boolean {
        try {
            val url = "${KV_BASE}?key=${username}&value=${java.net.URLEncoder.encode(tunnelUrl, "UTF-8")}"
            val request = Request.Builder().url(url).build()
            val response = httpClient.newCall(request).execute()
            if (response.isSuccessful) {
                Log.d(TAG, "KV updated: key=$username value=$tunnelUrl")
                emitTunnelLog("info", "KV updated for room \"$username\": $tunnelUrl")
                response.close()
                return true
            } else {
                Log.e(TAG, "KV update failed: HTTP ${response.code}")
                emitTunnelLog("error", "KV update failed: HTTP ${response.code}")
            }
            response.close()
        } catch (e: Exception) {
            Log.e(TAG, "KV update failed", e)
            emitTunnelLog("error", "KV update failed: ${e.message}")
        }

        return false
    }

    // --- Room WebSocket Server ---

    inner class RoomHttpServer(private val serverPort: Int, private val roomName: String) {

        @Volatile
        var roomStateJson: String = "{}"
        
        @Volatile
        var isRunning = true
        private var serverSocket: java.net.ServerSocket? = null
        
        private val connectedClients = CopyOnWriteArrayList<java.net.Socket>()
        private val clientIds = java.util.concurrent.ConcurrentHashMap<java.net.Socket, String>()

        fun start() {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    serverSocket = java.net.ServerSocket(serverPort)
                    Log.d("RoomHttpServer", "Server listening on port $serverPort")
                    while (isRunning) {
                        val socket = serverSocket!!.accept()
                        handleConnection(socket)
                    }
                } catch (e: Exception) {
                    if (isRunning) {
                        Log.e("RoomHttpServer", "Server error: ${e.message}")
                    }
                }
            }
        }

        private fun handleConnection(socket: java.net.Socket) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val input = socket.getInputStream()
                    val output = socket.getOutputStream()

                    // Read headers completely
                    var headerBytes = ByteArray(0)
                    var matchedEnd = false
                    while (true) {
                        val b = input.read()
                        if (b == -1) break
                        headerBytes += b.toByte()
                        val len = headerBytes.size
                        if (len >= 4 &&
                            headerBytes[len - 4].toInt() == 13 &&
                            headerBytes[len - 3].toInt() == 10 &&
                            headerBytes[len - 2].toInt() == 13 &&
                            headerBytes[len - 1].toInt() == 10
                        ) {
                            matchedEnd = true
                            break
                        }
                        if (len > 8192) break // sanity check
                    }

                    if (!matchedEnd) {
                        socket.close()
                        return@launch
                    }

                    val headerString = String(headerBytes, StandardCharsets.UTF_8)
                    val lines = headerString.split("\r\n")
                    if (lines.isEmpty()) return@launch

                    val requestLine = lines[0]
                    val parts = requestLine.split(" ")
                    val method = parts.getOrNull(0) ?: ""
                    val path = parts.getOrNull(1) ?: "/"

                    Log.d("RoomHttpServer", "Request: $method $path")

                    if (path == "/ws" || path.startsWith("/ws?")) {
                        handleWebSocketUpgrade(socket, input, output, lines.drop(1))
                        return@launch
                    }

                    val response = when {
                        path == "/" && method == "GET" -> {
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nAccess-Control-Allow-Origin: *\r\n\r\n<html><body><p>Sample route</p></body></html>"
                        }
                        else -> {
                            "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\n\r\nNot found"
                        }
                    }

                    output.write(response.toByteArray())
                    socket.close()

                } catch (e: Exception) {
                    Log.e("RoomHttpServer", "Connection error: ${e.message}")
                }
            }
        }

        private fun handleWebSocketUpgrade(
            socket: java.net.Socket,
            input: java.io.InputStream,
            output: java.io.OutputStream,
            headerLines: List<String>
        ) {
            try {
                var key = ""
                var upgrade = false
                for (line in headerLines) {
                    val lowerLine = line.lowercase()
                    if (lowerLine.startsWith("sec-websocket-key:")) {
                        key = line.substringAfter(":").trim()
                    }
                    if (lowerLine.contains("upgrade: websocket") || (lowerLine.startsWith("upgrade:") && lowerLine.contains("websocket"))) {
                        upgrade = true
                    }
                }

                if (!upgrade) {
                    output.write("HTTP/1.1 400 Bad Request\r\n\r\n".toByteArray())
                    socket.close()
                    return
                }

                val acceptKey = generateAcceptKey(key)
                val response = "HTTP/1.1 101 Switching Protocols\r\n" +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        "Sec-WebSocket-Accept: $acceptKey\r\n" +
                        "\r\n"
                output.write(response.toByteArray())
                output.flush()

                handleWebSocketFrames(socket, input)
            } catch (e: Exception) {
                Log.e("RoomHttpServer", "WS upgrade error: ${e.message}")
            }
        }

        private fun handleWebSocketFrames(socket: java.net.Socket, input: java.io.InputStream) {
            try {
                connectedClients.add(socket)
                
                if (roomStateJson.isNotEmpty() && roomStateJson != "{}") {
                    val frame = buildFrame(0x1, roomStateJson.toByteArray(StandardCharsets.UTF_8))
                    try {
                        socket.getOutputStream().write(frame)
                        socket.getOutputStream().flush()
                    } catch (_: Exception) {}
                }

                val buffer = ByteArray(2048)

                while (socket.isConnected && !socket.isClosed) {
                    val bytesRead = input.read(buffer)
                    if (bytesRead <= 0) break

                    val frame = parseWebSocketFrame(buffer.copyOf(bytesRead))
                    if (frame == null) continue

                    when (frame.opcode) {
                        0x1 -> {
                            val text = String(frame.payload, StandardCharsets.UTF_8)
                            handleMessage(socket, text)
                        }
                        0x8 -> {
                            break
                        }
                        0x9 -> {
                            val pongFrame = buildFrame(0xA, frame.payload)
                            try {
                                socket.getOutputStream().write(pongFrame)
                                socket.getOutputStream().flush()
                            } catch (_: Exception) {}
                        }
                        0xA -> { }
                    }
                }
            } catch (e: Exception) {
                Log.e("RoomHttpServer", "Frame error: ${e.message}")
            } finally {
                connectedClients.remove(socket)
                val clientId = clientIds.remove(socket)
                if (clientId != null) {
                    val leaveMsg = "{\"event\":\"leave\",\"clientId\":\"$clientId\"}"
                    broadcastMessage(leaveMsg)
                }
                try { socket.close() } catch (_: Exception) {}
            }
        }

        private fun handleMessage(socket: java.net.Socket, text: String) {
            try {
                val json = org.json.JSONObject(text)
                val event = json.optString("event", "")

                if (event == "ping") {
                    val pongData = "{\"event\":\"pong\",\"data\":{}}"
                    val frame = buildFrame(0x1, pongData.toByteArray(StandardCharsets.UTF_8))
                    try {
                        socket.getOutputStream().write(frame)
                        socket.getOutputStream().flush()
                    } catch (_: Exception) {}
                    Log.d("RoomHttpServer", "Sent pong response")
                } else if (event == "time_sync") {
                    // Reply immediately with System.currentTimeMillis() as hostTime.
                    // This is equivalent to Date.now() in the WebView — both use the system clock.
                    val t0 = json.optLong("t0", 0L)
                    val hostTime = System.currentTimeMillis()
                    val reply = "{\"event\":\"time_sync_reply\",\"t0\":$t0,\"hostTime\":$hostTime}"
                    val frame = buildFrame(0x1, reply.toByteArray(StandardCharsets.UTF_8))
                    try {
                        socket.getOutputStream().write(frame)
                        socket.getOutputStream().flush()
                    } catch (_: Exception) {}
                    Log.d("RoomHttpServer", "time_sync reply: t0=$t0 hostTime=$hostTime")
                } else if (event == "join") {
                    val clientId = json.optString("clientId", "")
                    val memberName = json.optString("memberName", "")
                    if (clientId.isNotEmpty()) {
                        clientIds[socket] = clientId
                        val joinMsg = "{\"event\":\"join\",\"clientId\":\"$clientId\",\"memberName\":\"$memberName\"}"
                        broadcastMessage(joinMsg)
                    }
                }
            } catch (e: Exception) {
                Log.e("RoomHttpServer", "Message parse error: ${e.message}")
            }
        }

        inner class WsFrame(val opcode: Int, val payload: ByteArray)

        private fun parseWebSocketFrame(data: ByteArray): WsFrame? {
            if (data.size < 2) return null
            val first = data[0].toInt()
            val second = data[1].toInt()
            val opcode = first and 0x0F
            val masked = (second and 0x80) != 0

            var payloadLength = second and 0x7F
            var offset = 2

            if (payloadLength == 126) {
                if (data.size < 4) return null
                payloadLength = ((data[2].toInt() and 0xFF) shl 8) or (data[3].toInt() and 0xFF)
                offset = 4
            } else if (payloadLength == 127) {
                if (data.size < 10) return null
                offset = 10
            }

            var mask = 0
            if (masked) {
                if (data.size < offset + 4) return null
                mask = ((data[offset].toInt() and 0xFF) shl 24) or
                        ((data[offset + 1].toInt() and 0xFF) shl 16) or
                        ((data[offset + 2].toInt() and 0xFF) shl 8) or
                        (data[offset + 3].toInt() and 0xFF)
                offset += 4
            }

            if (data.size < offset + payloadLength) return null

            val payload = if (masked) {
                val maskedPayload = data.copyOfRange(offset, offset + payloadLength)
                for (i in maskedPayload.indices) {
                    maskedPayload[i] = (maskedPayload[i].toInt() xor ((mask shr (24 - (i % 4) * 8)) and 0xFF)).toByte()
                }
                maskedPayload
            } else {
                data.copyOfRange(offset, offset + payloadLength)
            }

            return WsFrame(opcode, payload)
        }

        private fun generateAcceptKey(key: String): String {
            val magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            val combined = key + magic
            val digest = java.security.MessageDigest.getInstance("SHA-1")
            val hash = digest.digest(combined.toByteArray(StandardCharsets.UTF_8))
            return Base64.getEncoder().encodeToString(hash)
        }

        private fun buildFrame(opcode: Int, payload: ByteArray): ByteArray {
            val first = 0x80 or opcode
            val length = when {
                payload.size < 126 -> payload.size
                payload.size < 65536 -> 126
                else -> 127
            }
            val buffer = mutableListOf<Byte>()

            buffer.add(first.toByte())
            buffer.add(length.toByte())

            if (length == 126) {
                buffer.add((payload.size shr 8).toByte())
                buffer.add((payload.size and 0xFF).toByte())
            } else if (length == 127) {
                val size = payload.size.toLong()
                buffer.add((size shr 56).toByte())
                buffer.add((size shr 48).toByte())
                buffer.add((size shr 40).toByte())
                buffer.add((size shr 32).toByte())
                buffer.add((size shr 24).toByte())
                buffer.add((size shr 16).toByte())
                buffer.add((size shr 8).toByte())
                buffer.add((size and 0xFF).toByte())
            }

            buffer.addAll(payload.toList())
            return buffer.toByteArray()
        }

        fun pushState(json: String) {
            roomStateJson = json
            broadcastMessage(json)
        }

        private fun broadcastMessage(text: String) {
            val frame = buildFrame(0x1, text.toByteArray(StandardCharsets.UTF_8))
            val deadClients = mutableListOf<java.net.Socket>()
            for (client in connectedClients) {
                try {
                    client.getOutputStream().write(frame)
                    client.getOutputStream().flush()
                } catch (e: Exception) {
                    deadClients.add(client)
                }
            }
            connectedClients.removeAll(deadClients)
        }

        fun stop() {
            isRunning = false
            try { serverSocket?.close() } catch (_: Exception) {}
            for (client in connectedClients) {
                try { client.close() } catch (_: Exception) {}
            }
            connectedClients.clear()
            clientIds.clear()
        }
    }
}
