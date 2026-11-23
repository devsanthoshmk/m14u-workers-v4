package dev.m14u.app

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.IOException
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    companion object { const val SLEEP = "dev.m14u.app.SLEEP" }
    private var session: MediaSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().callTimeout(4, TimeUnit.SECONDS).build()

    private fun resolveFromProxy(proxy: String?, id: String): String? {
        if (proxy.isNullOrBlank()) return null
        val base = Uri.parse(proxy.trimEnd('/'))
        if (base.scheme != "https" || base.host.isNullOrBlank()) return null
        val request = Request.Builder().url("$base/api/v1/videos/$id?fields=adaptiveFormats").build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@use null
            val formats = JSONObject(response.body?.string() ?: return@use null).getJSONArray("adaptiveFormats")
            val stream = (0 until formats.length()).map { formats.getJSONObject(it) }
                .filter { it.optString("type").startsWith("audio/") && it.optString("url").startsWith("https://") }
                .maxByOrNull { it.optLong("bitrate") } ?: return@use null
            Uri.parse(stream.getString("url")).buildUpon().encodedAuthority(base.encodedAuthority).build().toString()
        }
    }

    override fun onCreate() {
        super.onCreate()
        // Runs on the native loader thread, including when the WebView is suspended.
        val source = ResolvingDataSource.Factory(DefaultHttpDataSource.Factory()) { spec ->
            if (spec.uri.scheme != "m14u-track") return@Factory spec
            val id = spec.uri.lastPathSegment ?: throw IOException("Missing track ID")
            val url = try {
                StreamExtractorPlugin.ensureInitialized()
                StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$id")
                    .audioStreams.filter { it.isUrl && it.content.startsWith("https://") }
                    .maxByOrNull { it.averageBitrate }?.content
                    ?: throw IOException("No audio streams found")
            } catch (e: Exception) {
                runCatching { resolveFromProxy(spec.uri.getQueryParameter("proxy"), id) }.getOrNull()
                    ?: throw IOException("Could not resolve the audio stream", e)
            }
            spec.withUri(Uri.parse(url))
        }
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(ProgressiveMediaSource.Factory(source))
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        val activity = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val sleepCommand = SessionCommand(SLEEP, Bundle.EMPTY)
        val callback = object : MediaSession.Callback {
            override fun onConnect(s: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                val base = super.onConnect(s, controller)
                if (controller.packageName != packageName) return base
                return MediaSession.ConnectionResult.AcceptedResultBuilder(s)
                    .setAvailableSessionCommands(base.availableSessionCommands.buildUpon().add(sleepCommand).build())
                    .build()
            }

            override fun onCustomCommand(s: MediaSession, controller: MediaSession.ControllerInfo,
                command: SessionCommand, args: Bundle): com.google.common.util.concurrent.ListenableFuture<SessionResult> {
                if (command.customAction != SLEEP || controller.packageName != packageName) {
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
                }
                val seconds = args.getLong("seconds")
                handler.removeCallbacksAndMessages(null)
                player.setPauseAtEndOfMediaItems(seconds == -1L)
                if (seconds > 0) handler.postDelayed({ player.pause() }, seconds * 1000)
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
        }
        player.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (reason == androidx.media3.common.Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    player.setPauseAtEndOfMediaItems(false)
                }
            }
        })
        session = MediaSession.Builder(this, player).setCallback(callback).setSessionActivity(activity).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        session?.let {
            it.player.release()
            it.release()
        }
        session = null
        super.onDestroy()
    }
}
