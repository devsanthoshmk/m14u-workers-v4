package dev.m14u.app

import android.util.Log
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
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.StreamInfo

@CapacitorPlugin(name = "StreamExtractor")
class StreamExtractorPlugin : Plugin() {

    companion object {
        private const val TAG = "StreamExtractor"
        private var initialized = false
    }

    private fun ensureInitialized() {
        if (!initialized) {
            // Match exactly how yt-audio-extractor initializes — simple init, no localization overload
            NewPipe.init(OkHttpDownloader())
            initialized = true
            Log.d(TAG, "NewPipeExtractor initialized")
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
                Log.d(TAG, "getStreamUrl: fetching $url")
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)
                val audioStreams: List<AudioStream> = info.audioStreams

                if (audioStreams.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        call.reject("No audio streams found")
                    }
                    return@launch
                }

                val sorted = audioStreams.sortedByDescending { it.averageBitrate }
                val best = sorted.first()

                Log.d(TAG, "getStreamUrl: best stream ${best.averageBitrate}kbps ${best.getFormat()?.name ?: "unknown"}")

                val result = JSObject().apply {
                    put("url", best.content)
                    put("type", best.getFormat()?.mimeType ?: "audio/webm")
                    put("bitrate", best.averageBitrate)
                    put("codec", best.codec ?: "opus")
                }
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                Log.e(TAG, "getStreamUrl failed", e)
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
                Log.d(TAG, "getStreamData: fetching $url")
                val info = StreamInfo.getInfo(ServiceList.YouTube, url)

                val audioStreams: List<AudioStream> = info.audioStreams
                Log.d(TAG, "getStreamData: found ${audioStreams.size} audio streams")

                if (audioStreams.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        call.reject("No audio streams found for $videoId")
                    }
                    return@launch
                }

                // Sort by bitrate descending, matching yt-audio-extractor
                val sorted = audioStreams.sortedByDescending { it.averageBitrate }

                val formats = JSArray()
                for (stream in sorted) {
                    val format = JSObject().apply {
                        put("url", stream.content)
                        put("type", stream.getFormat()?.mimeType ?: "audio/webm")
                        put("bitrate", stream.averageBitrate.toString())
                        put("encoding", stream.codec ?: "opus")
                    }
                    formats.put(format)
                }

                val result = JSObject().apply {
                    put("adaptiveFormats", formats)
                    put("title", info.name)
                }

                Log.d(TAG, "getStreamData: success, title=${info.name}, streams=${sorted.size}")
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                Log.e(TAG, "getStreamData failed for $videoId", e)
                withContext(Dispatchers.Main) {
                    call.reject("Stream data extraction failed: ${e.message}", e)
                }
            }
        }
    }
}
