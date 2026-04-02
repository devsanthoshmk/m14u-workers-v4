package dev.m14u.app

import android.content.Intent
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader

@CapacitorPlugin(name = "DevTunnel")
class DevTunnelPlugin : Plugin(), TunnelService.EventListener {

    companion object {
        private const val TAG = "DevTunnel"
        private const val URL_POLL_INTERVAL_MS = 500L
        private const val URL_POLL_TIMEOUT_MS = 60_000L
    }

    override fun load() {
        super.load()
        // If service is already running, register as listener
        TunnelService.instance?.eventListener = this
    }

    @PluginMethod
    fun startTunnel(call: PluginCall) {
        val port = call.getInt("port", 8080) ?: 8080
        val username = call.getString("username")
        if (username.isNullOrEmpty()) {
            call.reject("username is required")
            return
        }

        val previousGeneration = TunnelService.instance?.startupGeneration ?: 0L

        // Register as event listener
        TunnelService.instance?.eventListener = this

        val intent = Intent(context, TunnelService::class.java).apply {
            putExtra("username", username)
            putExtra("port", port)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        // Poll for the tunnel URL (set by the service)
        CoroutineScope(Dispatchers.IO).launch {
            val startTime = System.currentTimeMillis()
            var url: String? = null
            while (System.currentTimeMillis() - startTime < URL_POLL_TIMEOUT_MS) {
                // Re-register listener after service creates its instance
                val service = TunnelService.instance
                service?.eventListener = this@DevTunnelPlugin

                val generation = service?.startupGeneration ?: 0L
                url = service?.currentTunnelUrl
                if (generation > previousGeneration && !url.isNullOrBlank()) break

                delay(URL_POLL_INTERVAL_MS)
            }
            withContext(Dispatchers.Main) {
                if (!url.isNullOrBlank()) {
                    call.resolve(JSObject().apply { put("url", url) })
                } else {
                    call.reject("Timed out waiting for tunnel URL")
                }
            }
        }
    }

    @PluginMethod
    fun debugTunnel(call: PluginCall) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val nativeDir = activity.applicationInfo.nativeLibraryDir
                val binary = "$nativeDir/libcloudflared.so"
                val file = java.io.File(binary)
                val exists = file.exists()
                val canExec = file.canExecute()
                val size = if (exists) file.length() else 0

                val pbVer = ProcessBuilder(binary, "version")
                pbVer.redirectErrorStream(true)
                val procVer = pbVer.start()
                val verOutput = BufferedReader(InputStreamReader(procVer.inputStream)).readText()
                val verExit = procVer.waitFor()

                val pbTunnel = ProcessBuilder(binary, "tunnel", "--url", "http://localhost:8080")
                pbTunnel.redirectErrorStream(true)
                val procTunnel = pbTunnel.start()
                val tunnelLines = mutableListOf<String>()
                val reader = BufferedReader(InputStreamReader(procTunnel.inputStream))

                val readThread = Thread {
                    try {
                        var l: String?
                        while (reader.readLine().also { l = it } != null) {
                            tunnelLines.add(l!!)
                            if (tunnelLines.size > 50) break
                        }
                    } catch (_: Exception) {}
                }
                readThread.start()
                readThread.join(15000)
                val alive = procTunnel.isAlive
                if (!alive) readThread.join(1000)
                val tunnelExit = if (!alive) procTunnel.exitValue() else -1
                procTunnel.destroy()

                val result = JSObject().apply {
                    put("binary", binary)
                    put("exists", exists)
                    put("canExecute", canExec)
                    put("size", size)
                    put("versionOutput", verOutput)
                    put("versionExitCode", verExit)
                    put("tunnelOutput", tunnelLines.joinToString("\n"))
                    put("tunnelLineCount", tunnelLines.size)
                    put("tunnelExitCode", tunnelExit)
                    put("tunnelStillAlive", alive)
                }
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    call.reject("debugTunnel failed: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val msg = call.getString("message")
        if (msg.isNullOrEmpty()) {
            call.reject("message is required")
            return
        }
        call.reject("sendMessage is deprecated — use updateRoomState instead")
    }

    @PluginMethod
    fun updateRoomState(call: PluginCall) {
        val state = call.getString("state")
        if (state.isNullOrEmpty()) {
            call.reject("state is required")
            return
        }
        val service = TunnelService.instance
        if (service == null) {
            call.reject("Tunnel not running")
            return
        }
        service.updateRoomState(state)
        call.resolve()
    }

    @PluginMethod
    fun stopTunnel(call: PluginCall) {
        context.stopService(Intent(context, TunnelService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun getTunnelUrl(call: PluginCall) {
        val url = TunnelService.instance?.currentTunnelUrl ?: ""
        call.resolve(JSObject().apply { put("url", url) })
    }

    override fun handleOnDestroy() {
        // Do NOT stop the service — tunnel survives app close
        TunnelService.instance?.eventListener = null
        super.handleOnDestroy()
    }

    // --- TunnelService.EventListener ---

    override fun onTunnelLog(event: JSObject) {
        notifyListeners("tunnelLog", event)
    }

    override fun onTunnelPanic(event: JSObject) {
        notifyListeners("tunnelPanic", event)
    }
}
