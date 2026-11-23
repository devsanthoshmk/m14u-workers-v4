package dev.m14u.app

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
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

@CapacitorPlugin(name = "NativePlayback")
class NativePlaybackPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private var connection: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var lastPauseWasEndOfItem = false
    private val ticker = object : Runnable {
        override fun run() {
            if (controller?.isPlaying == true && bridge.webView.windowVisibility == android.view.View.VISIBLE) publish()
            main.postDelayed(this, 1000)
        }
    }

    private fun withController(call: PluginCall, action: (MediaController) -> Unit) {
        main.post {
            val future = connection ?: MediaController.Builder(context,
                SessionToken(context, ComponentName(context, PlaybackService::class.java)))
                .buildAsync().also { connection = it }
            future.addListener({
                if (connection !== future) return@addListener
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
    }

    private fun publish() {
        controller?.let { notifyListeners("state", snapshot(it)) }
    }

    private fun items(call: PluginCall): List<MediaItem> {
        val rows = call.getArray("queue") ?: JSONArray()
        return (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val id = row.getString("id")
            require(id.matches(Regex("[A-Za-z0-9_-]{11}"))) { "Invalid track ID" }
            val artwork = row.optString("artwork")
            val unresolved = Uri.Builder().scheme("m14u-track").authority("youtube").appendPath(id)
                .appendQueryParameter("proxy", row.optString("proxy")).build()
            val metadata = MediaMetadata.Builder().setTitle(row.optString("title")).setArtist(row.optString("artist"))
            if (artwork.startsWith("https://")) metadata.setArtworkUri(Uri.parse(artwork))
            MediaItem.Builder().setMediaId(row.getString("queueId"))
                .setUri(row.optString("url").ifBlank { unresolved.toString() })
                .setMediaMetadata(metadata.build()).build()
        }
    }

    @PluginMethod
    fun loadQueue(call: PluginCall) = withController(call) { player ->
        val queue = items(call)
        val index = call.getInt("index", 0) ?: 0
        player.setMediaItems(queue, index, 0)
        player.repeatMode = call.getInt("repeat", 0) ?: 0
        player.volume = (call.getDouble("volume", 1.0) ?: 1.0).toFloat()
        player.playWhenReady = call.getBoolean("play", true) == true
        player.prepare()
        call.resolve(snapshot(player))
    }

    @PluginMethod
    fun updateQueue(call: PluginCall) = withController(call) { player ->
        val queue = items(call)
        val currentId = player.currentMediaItem?.mediaId
        val replacement = queue.indexOfFirst { it.mediaId == currentId }
        if (replacement >= 0) {
            val index = player.currentMediaItemIndex
            // Keep the current MediaSource (and its buffers) intact on queue edits.
            player.replaceMediaItems(index + 1, player.mediaItemCount, queue.subList(replacement + 1, queue.size))
            player.replaceMediaItems(0, index, queue.subList(0, replacement))
        }
        call.resolve()
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
            "clear" -> { player.pause(); player.clearMediaItems(); player.stop() }
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
        main.removeCallbacks(ticker)
        connection?.let { MediaController.releaseFuture(it) }
        connection = null
        controller = null
        super.handleOnDestroy()
    }
}
