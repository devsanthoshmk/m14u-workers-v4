package dev.m14u.app

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo

@CapacitorPlugin(name = "StreamExtractor")
class StreamExtractorPlugin : Plugin() {

    companion object {
        private var initialized = false
    }

    private fun ensureInitialized() {
        if (!initialized) {
            NewPipe.init(DownloaderImpl.getInstance())
            initialized = true
        }
    }

    @PluginMethod
    fun getStreamUrl(call: PluginCall) {
        val videoId = call.getString("videoId")
        if (videoId.isNullOrEmpty()) {
            call.reject("videoId is required")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInitialized()
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStreams = info.audioStreams

                if (audioStreams.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        call.reject("No audio streams found")
                    }
                    return@launch
                }

                val best = audioStreams.maxByOrNull { it.averageBitrate }!!
                val result = JSObject().apply {
                    put("url", best.content)
                    put("type", best.format?.mimeType ?: "audio/webm")
                    put("bitrate", best.averageBitrate)
                    put("codec", best.codec ?: "opus")
                }
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    call.reject("Stream extraction failed: ${e.message}", e)
                }
            }
        }
    }

    @PluginMethod
    fun getStreamData(call: PluginCall) {
        val videoId = call.getString("videoId")
        if (videoId.isNullOrEmpty()) {
            call.reject("videoId is required")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInitialized()
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)

                val formats = JSArray()
                for (stream in info.audioStreams) {
                    val format = JSObject().apply {
                        put("url", stream.content)
                        put("type", stream.format?.mimeType ?: "audio/webm")
                        put("bitrate", stream.averageBitrate.toString())
                        put("encoding", stream.codec ?: "opus")
                    }
                    formats.put(format)
                }

                val result = JSObject().apply {
                    put("adaptiveFormats", formats)
                    put("title", info.name)
                }
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    call.reject("Stream data extraction failed: ${e.message}", e)
                }
            }
        }
    }
}
