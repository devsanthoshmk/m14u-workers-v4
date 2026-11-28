package dev.m14u.app

import android.content.ComponentName
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.javascriptengine.JavaScriptSandbox
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "NativePlayback")
class NativePlaybackPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private val registry = PlaybackSourceRegistry.shared
    private var connection: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var destroyed = false
    private var lastPauseWasEndOfItem = false
    private val ticker = object : Runnable {
        override fun run() {
            if (controller?.isPlaying == true && bridge.webView.windowVisibility == android.view.View.VISIBLE) publish()
            main.postDelayed(this, 1000)
        }
    }

    private data class ParsedQueue(
        val generation: Long?,
        val mediaItems: List<MediaItem>,
        val descriptors: List<QueueEntryDescriptor>,
    )

    private fun withController(call: PluginCall, action: (MediaController) -> Unit) {
        main.post {
            if (destroyed) {
                call.reject("Android playback bridge closed")
                return@post
            }
            val future = connection ?: MediaController.Builder(context,
                SessionToken(context, ComponentName(context, PlaybackService::class.java)))
                .buildAsync().also { connection = it }
            future.addListener({
                if (connection !== future) {
                    call.reject("Android playback connection closed")
                    return@addListener
                }
                try {
                    val player = future.get()
                    if (controller !== player) {
                        controller = player
                        player.addListener(object : Player.Listener {
                            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                                lastPauseWasEndOfItem = !playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM
                            }

                            override fun onEvents(player: Player, events: Player.Events) = publish()
                        })
                        main.post(ticker)
                    }
                    action(player)
                } catch (e: Exception) {
                    if (controller == null) connection = null
                    call.reject("Android playback: ${e.message}", e)
                }
            }, ContextCompat.getMainExecutor(context))
        }
    }

    private fun snapshot(player: Player) = JSObject().apply {
        put("queueId", player.currentMediaItem?.mediaId ?: "")
        put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
        put("duration", if (player.duration == C.TIME_UNSET) 0.0 else player.duration / 1000.0)
        put("playing", player.isPlaying)
        put("buffering", player.playbackState == Player.STATE_BUFFERING && player.playWhenReady)
        put("sleepEnded", !player.playWhenReady && player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE &&
            lastPauseWasEndOfItem)
        put("error", player.playerError?.let { "Could not play this stream (${it.errorCodeName})" } ?: "")
        registry.currentGeneration()?.let { put("generation", it) }
    }

    private fun publish() {
        controller?.let { notifyListeners("state", snapshot(it)) }
    }

    private fun parseQueue(call: PluginCall): ParsedQueue {
        val hasGen = call.data.has("generation") && !call.data.isNull("generation")
        val generation = optFiniteLong(call.data, "generation")
        if (hasGen && generation == null) throw IllegalArgumentException("Invalid generation")

        val rows = call.getArray("queue") ?: JSONArray()
        require(rows.length() <= PlaybackSourceRegistry.DEFAULT_MAX_QUEUE_ITEMS) { "Queue exceeds maximum size" }

        val seenQueueIds = HashSet<String>(rows.length())
        val mediaItems = ArrayList<MediaItem>(rows.length())
        val descriptors = ArrayList<QueueEntryDescriptor>(rows.length())

        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            val queueId = row.getString("queueId")
            require(PlaybackSourceRegistry.isValidQueueId(queueId)) { "Invalid queueId" }
            require(seenQueueIds.add(queueId)) { "Duplicate queueId: $queueId" }

            val id = row.optString("id", "")
            val resolverKey = parseResolverKeyStrict(row, "resolverKey")
            val explicitSource = parseTrackSourceStrict(row, "source")
            val legacyUrl = row.optString("url", "").trim()
            if (legacyUrl.isNotEmpty()) {
                require(PlaybackSourceRegistry.validateHttpsUrl(legacyUrl) != null) { "Invalid stream URL" }
            }

            if (resolverKey != null) {
                when (resolverKey.provider) {
                    "youtube" -> require(PlaybackSourceRegistry.YOUTUBE_ID_REGEX.matches(resolverKey.trackId)) { "Invalid YouTube track ID" }
                    "jiosaavn" -> require(PlaybackSourceRegistry.extractSaavnRawId(resolverKey.trackId) != null) { "Invalid JioSaavn track ID" }
                }
            } else if (explicitSource == null && legacyUrl.isEmpty()) {
                require(PlaybackSourceRegistry.YOUTUBE_ID_REGEX.matches(id)) { "Invalid track ID" }
            }

            val isV2Item = generation != null || explicitSource != null || resolverKey != null
            val effectiveResolverKey = resolverKey
                ?: id.takeIf { PlaybackSourceRegistry.YOUTUBE_ID_REGEX.matches(it) }?.let { ResolverKey("youtube", it) }
            val effectiveSource = explicitSource
                ?: legacyUrl.takeIf { it.isNotEmpty() && isV2Item }?.let { TrackSource(url = it) }
            val legacyProxy = row.optString("proxy", "").trim().takeIf { it.isNotEmpty() }

            descriptors.add(QueueEntryDescriptor(
                queueId = queueId,
                resolverKey = effectiveResolverKey,
                source = effectiveSource,
                legacyProxy = legacyProxy,
            ))

            val artwork = row.optJSONArray("artwork") ?: JSONArray()
            val metadata = MediaMetadata.Builder()
                .setTitle(row.optString("title"))
                .setArtist(row.optString("artist"))
            val candidates = (0 until artwork.length()).map { artwork.optString(it) }
                .filter { it.startsWith("https://") }.take(10)
            if (candidates.isNotEmpty()) {
                val uri = Uri.Builder().scheme(MediaArtworkLoader.SCHEME).authority("track")
                candidates.forEach { uri.appendQueryParameter("url", it) }
                metadata.setArtworkUri(uri.build())
            }

            val mediaUri = if (isV2Item) {
                Uri.Builder()
                    .scheme(PlaybackSourceRegistry.RESOLVE_SCHEME)
                    .authority(PlaybackSourceRegistry.RESOLVE_AUTHORITY)
                    .appendPath(queueId)
                    .build()
                    .toString()
            } else {
                legacyUrl.ifEmpty {
                    Uri.Builder()
                        .scheme(PlaybackSourceRegistry.LEGACY_TRACK_SCHEME)
                        .authority("youtube")
                        .appendPath(id)
                        .appendQueryParameter("proxy", legacyProxy ?: "")
                        .build()
                        .toString()
                }
            }

            mediaItems.add(
                MediaItem.Builder()
                    .setMediaId(queueId)
                    .setUri(mediaUri)
                    .setMediaMetadata(metadata.build())
                    .build()
            )
        }
        return ParsedQueue(generation = generation, mediaItems = mediaItems, descriptors = descriptors)
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val sandboxSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            runCatching { JavaScriptSandbox.isSupported() }.getOrDefault(false)
        val resolverConfigured = PlaybackService.hasHeadlessResolverConfig()
        call.resolve(JSObject().apply {
            put("abiVersion", 2)
            put("sourceRefresh", true)
            put("localMedia", false)
            put("headlessResolver", sandboxSupported && resolverConfigured)
            put("sandboxSupported", sandboxSupported)
            put("saavnUnprimed", PlaybackService.isSaavnUnprimedSupported())
            put("resolverAbi", "androidx-js-1")
        })
    }

    @PluginMethod
    fun loadQueue(call: PluginCall) {
        val parsed = try {
            parseQueue(call)
        } catch (e: Exception) {
            call.reject("Invalid queue: ${e.message}", e)
            return
        }
        val requestedIndex = call.getInt("index", 0) ?: 0
        val repeat = call.getInt("repeat", 0) ?: 0
        val volume = (call.getDouble("volume", 1.0) ?: 1.0).toFloat()
        val play = call.getBoolean("play", true) == true

        withController(call) { player ->
            val safeIndex = if (parsed.mediaItems.isEmpty()) 0 else requestedIndex.coerceIn(0, parsed.mediaItems.size - 1)
            val activeQueueId = parsed.descriptors.getOrNull(safeIndex)?.queueId
            registry.replaceQueue(parsed.generation, parsed.descriptors, activeQueueId)
            player.setMediaItems(parsed.mediaItems, safeIndex, 0)
            player.repeatMode = repeat
            player.volume = volume
            player.playWhenReady = play
            player.prepare()
            call.resolve(snapshot(player))
        }
    }

    @PluginMethod
    fun updateQueue(call: PluginCall) {
        val parsed = try {
            parseQueue(call)
        } catch (e: Exception) {
            call.reject("Invalid queue update: ${e.message}", e)
            return
        }
        withController(call) { player ->
            if (player.mediaItemCount == 0 && parsed.mediaItems.isEmpty()) {
                registry.updateQueue(parsed.generation, parsed.descriptors, activeQueueId = null)
                call.resolve()
                return@withController
            }
            val currentId = player.currentMediaItem?.mediaId
            val replacement = if (currentId != null) parsed.mediaItems.indexOfFirst { it.mediaId == currentId } else -1
            if (replacement < 0) {
                call.reject("Active track missing from queue update")
                return@withController
            }
            val index = player.currentMediaItemIndex
            registry.updateQueue(parsed.generation, parsed.descriptors, activeQueueId = currentId)
            // Keep the current MediaSource (and its buffers) intact on queue edits.
            player.replaceMediaItems(index + 1, player.mediaItemCount, parsed.mediaItems.subList(replacement + 1, parsed.mediaItems.size))
            player.replaceMediaItems(0, index, parsed.mediaItems.subList(0, replacement))
            call.resolve()
        }
    }

    @PluginMethod
    fun setResolvedSources(call: PluginCall) {
        val generation = optFiniteLong(call.data, "generation")
        if (generation == null) {
            call.reject("Invalid generation")
            return
        }
        val rawEntries = call.getArray("entries") ?: JSONArray()
        if (rawEntries.length() > MAX_SET_SOURCES_PAYLOAD) {
            call.reject("Too many resolved source entries")
            return
        }

        val parsedEntries = ArrayList<ResolvedSourceInput>(rawEntries.length())
        var malformed = 0
        for (i in 0 until rawEntries.length()) {
            val item = rawEntries.optJSONObject(i)
            val parsed = item?.let(::parseResolvedSourceEntryLenient)
            if (parsed != null) parsedEntries.add(parsed) else malformed++
        }

        main.post {
            if (destroyed) {
                call.reject("Android playback bridge closed")
                return@post
            }
            val applySources = {
                val result = registry.setResolvedSources(generation, parsedEntries)
                call.resolve(JSObject().apply {
                    put("updated", result.updated)
                    put("rejected", result.rejected + malformed)
                })
            }
            val pendingConnection = connection
            if (pendingConnection != null) {
                pendingConnection.addListener({
                    if (destroyed || connection !== pendingConnection) {
                        call.reject("Android playback connection closed")
                    } else {
                        applySources()
                    }
                }, ContextCompat.getMainExecutor(context))
            } else {
                applySources()
            }
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) = withController(call) { call.resolve(snapshot(it)) }

    @PluginMethod
    fun control(call: PluginCall) = withController(call) { player ->
        when (call.getString("action")) {
            "play" -> {
                if (player.playbackState == Player.STATE_IDLE) player.prepare()
                if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
                player.play()
            }
            "pause" -> player.pause()
            "clear" -> {
                registry.clear()
                player.pause()
                player.clearMediaItems()
                player.stop()
            }
            "seek" -> player.seekTo(((call.getDouble("value") ?: 0.0).coerceAtLeast(0.0) * 1000).toLong())
            "repeat" -> player.repeatMode = call.getInt("value", 0) ?: 0
            "volume" -> player.volume = (call.getDouble("value", 1.0) ?: 1.0).toFloat()
            "sleep" -> player.sendCustomCommand(SessionCommand(PlaybackService.SLEEP, Bundle.EMPTY), Bundle().apply {
                putLong("seconds", (call.getInt("value", 0) ?: 0).toLong())
            })
        }
        call.resolve(snapshot(player))
    }

    override fun handleOnDestroy() {
        destroyed = true
        main.removeCallbacks(ticker)
        val future = connection
        connection = null
        controller = null
        future?.let { MediaController.releaseFuture(it) }
        super.handleOnDestroy()
    }

    private companion object {
        const val MAX_SET_SOURCES_PAYLOAD = 512

        fun optFiniteLong(obj: JSONObject, key: String): Long? {
            if (!obj.has(key) || obj.isNull(key)) return null
            val raw = obj.opt(key)
            return when (raw) {
                is Int -> if (raw >= 0) raw.toLong() else null
                is Long -> if (raw in 0L..9_007_199_254_740_991L) raw else null
                is Number -> {
                    val d = raw.toDouble()
                    if (d.isFinite() && d % 1.0 == 0.0 && d >= 0.0 && d <= 9_007_199_254_740_991.0) d.toLong() else null
                }
                else -> null
            }
        }

        fun parseResolverKeyStrict(parent: JSONObject, field: String): ResolverKey? {
            if (!parent.has(field) || parent.isNull(field)) return null
            val obj = parent.optJSONObject(field) ?: throw IllegalArgumentException("Invalid resolverKey")
            val key = ResolverKey(obj.optString("provider", ""), obj.optString("trackId", ""))
            require(PlaybackSourceRegistry.isValidResolverKey(key)) { "Invalid resolverKey" }
            return key
        }

        fun parseTrackSourceStrict(parent: JSONObject, field: String): TrackSource? {
            if (!parent.has(field) || parent.isNull(field)) return null
            val obj = parent.optJSONObject(field) ?: throw IllegalArgumentException("Invalid source")
            return parseTrackSourceObject(obj) ?: throw IllegalArgumentException("Invalid source")
        }

        fun parseTrackSourceObject(obj: JSONObject): TrackSource? {
            val url = PlaybackSourceRegistry.validateHttpsUrl(obj.optString("url", "")) ?: return null
            val mimeType = if (obj.has("mimeType") && !obj.isNull("mimeType")) {
                obj.optString("mimeType", "").trim().takeIf { it.isNotEmpty() }
            } else null
            val expiresAtMs = if (obj.has("expiresAtMs") && !obj.isNull("expiresAtMs")) {
                optFiniteLong(obj, "expiresAtMs") ?: return null
            } else null
            val headers = if (obj.has("headers") && !obj.isNull("headers")) {
                val headersObj = obj.optJSONObject("headers") ?: return null
                val rawMap = LinkedHashMap<String, String>(headersObj.length())
                val keys = headersObj.keys()
                while (keys.hasNext()) {
                    val name = keys.next()
                    val value = headersObj.opt(name) as? String ?: return null
                    rawMap[name] = value
                }
                PlaybackSourceRegistry.sanitizeHeaders(rawMap) ?: return null
            } else emptyMap()
            return TrackSource(url = url, mimeType = mimeType, headers = headers, expiresAtMs = expiresAtMs)
        }

        fun parseResolvedSourceEntryLenient(obj: JSONObject): ResolvedSourceInput? {
            val queueId = obj.optString("queueId", "")
            if (!PlaybackSourceRegistry.isValidQueueId(queueId)) return null
            val resolverKey = if (obj.has("resolverKey") && !obj.isNull("resolverKey")) {
                val keyObj = obj.optJSONObject("resolverKey") ?: return null
                val key = ResolverKey(keyObj.optString("provider", ""), keyObj.optString("trackId", ""))
                if (!PlaybackSourceRegistry.isValidResolverKey(key)) return null
                key
            } else null
            val sourceObj = obj.optJSONObject("source") ?: return null
            val source = parseTrackSourceObject(sourceObj) ?: return null
            return ResolvedSourceInput(queueId = queueId, resolverKey = resolverKey, source = source)
        }
    }
}
