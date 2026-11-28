package dev.m14u.app

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.File
import java.io.IOException
import java.io.StringReader
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    companion object {
        const val SLEEP = "dev.m14u.app.SLEEP"
        private const val TAG = "PlaybackService"
        private const val RESOLVER_TIMEOUT_MS = 12_000L
        private val KEY_ID_REGEX = Regex("[A-Za-z0-9_-]{1,48}")

        internal fun parsePinnedKeys(raw: String): Map<String, String> {
            val trimmed = raw.trim()
            if (trimmed.isEmpty()) return emptyMap()
            val result = LinkedHashMap<String, String>()
            if (trimmed.startsWith("{")) {
                runCatching {
                    JsonReader(StringReader(trimmed)).use { reader ->
                        reader.strictness = Strictness.STRICT
                        reader.beginObject()
                        while (reader.hasNext()) {
                            val keyId = reader.nextName().trim()
                            if (reader.peek() == JsonToken.STRING) {
                                val value = reader.nextString().trim()
                                if (KEY_ID_REGEX.matches(keyId) && value.isNotEmpty()) {
                                    result[keyId] = value
                                }
                            } else {
                                reader.skipValue()
                            }
                        }
                        reader.endObject()
                    }
                }
                return result
            }
            for (entry in trimmed.split(',', ';')) {
                val sep = entry.indexOf('=')
                if (sep <= 0) continue
                val keyId = entry.substring(0, sep).trim()
                val value = entry.substring(sep + 1).trim()
                if (KEY_ID_REGEX.matches(keyId) && value.isNotEmpty()) {
                    result[keyId] = value
                }
            }
            return result
        }

        internal fun parseManifestUrl(raw: String): HttpUrl? {
            val url = raw.trim().toHttpUrlOrNull() ?: return null
            if (!url.isHttps || url.port != 443 || url.username.isNotEmpty() ||
                url.password.isNotEmpty() || url.query != null || url.fragment != null ||
                url.encodedPath != "/resolvers/v2/manifest.json") {
                return null
            }
            return url
        }

        internal fun hasHeadlessResolverConfig(): Boolean =
            parsePinnedKeys(BuildConfig.RESOLVER_V2_PUBLIC_KEYS).isNotEmpty() &&
                parseManifestUrl(BuildConfig.RESOLVER_V2_MANIFEST_URL) != null

        internal fun parseSaavnAudioOrigin(raw: String): String? {
            val trimmed = raw.trim()
            if (trimmed.isEmpty()) return null
            val validated = PlaybackSourceRegistry.validateHttpsUrl(trimmed) ?: return null
            val url = validated.toHttpUrlOrNull() ?: return null
            if (url.encodedPath != "/" || url.query != null || url.fragment != null) {
                return null
            }
            return validated.trimEnd('/')
        }

        internal fun isSaavnUnprimedSupported(): Boolean =
            parseSaavnAudioOrigin(BuildConfig.JIOSAAVN_AUDIO_ORIGIN) != null

        internal fun buildJioSaavnStreamUrl(origin: String, trackId: String): String? {
            val validatedOrigin = parseSaavnAudioOrigin(origin) ?: return null
            val rawId = PlaybackSourceRegistry.extractSaavnRawId(trackId) ?: return null
            val encodedId = Uri.encode(rawId) ?: rawId
            val candidate = "$validatedOrigin/api/audio/$encodedId"
            return PlaybackSourceRegistry.validateHttpsUrl(candidate)
        }

        internal fun shouldRetryLoadError(
            error: IOException,
            scheme: String?,
            queueId: String?,
            registry: PlaybackSourceRegistry,
        ): Boolean {
            if (error is TerminalPlaybackIOException) return false
            if (scheme == PlaybackSourceRegistry.RESOLVE_SCHEME && queueId != null) {
                return registry.tryConsumeRetry(queueId)
            }
            return true
        }

        internal fun createLoadErrorHandlingPolicy(
            registry: PlaybackSourceRegistry,
        ): LoadErrorHandlingPolicy = object : DefaultLoadErrorHandlingPolicy(1) {
            override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                val error = loadErrorInfo.exception
                val uri = loadErrorInfo.loadEventInfo.uri
                if (!shouldRetryLoadError(error, uri?.scheme, uri?.lastPathSegment, registry)) {
                    return C.TIME_UNSET
                }
                return super.getRetryDelayMsFor(loadErrorInfo)
            }
        }
    }

    internal class TerminalPlaybackIOException(message: String, cause: Throwable? = null) : IOException(message, cause)

    private sealed class BundleResolveResult {
        data class Resolved(val url: String) : BundleResolveResult()
        data class Transient(val reason: String) : BundleResolveResult()
        data class Fault(val reason: String) : BundleResolveResult()
    }

    private var session: MediaSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private val registry = PlaybackSourceRegistry.shared
    private val http = OkHttpClient.Builder().callTimeout(4, TimeUnit.SECONDS).build()
    private var resolverRepo: ResolverBundleRepository? = null
    private var resolverEngine: ResolverEngine? = null
    private var refreshExecutor: ExecutorService? = null

    private fun resolveFromProxy(proxy: String?, id: String): String? {
        if (proxy.isNullOrBlank()) return null
        val validatedBase = PlaybackSourceRegistry.validateHttpsUrl(proxy.trimEnd('/'))?.trimEnd('/') ?: return null
        val base = Uri.parse(validatedBase)
        val request = Request.Builder().url("$validatedBase/api/v1/videos/$id?fields=adaptiveFormats").build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@use null
            val formats = JSONObject(response.body?.string() ?: return@use null).getJSONArray("adaptiveFormats")
            val stream = (0 until formats.length()).map { formats.getJSONObject(it) }
                .filter { it.optString("type").startsWith("audio/") && it.optString("url").startsWith("https://") }
                .maxByOrNull { it.optLong("bitrate") } ?: return@use null
            val candidate = Uri.parse(stream.getString("url")).buildUpon().encodedAuthority(base.encodedAuthority).build().toString()
            PlaybackSourceRegistry.validateHttpsUrl(candidate)
        }
    }

    private fun pickBestAudioUrl(rawJson: String): String? = runCatching {
        val json = JSONObject(rawJson)
        val formats = json.optJSONArray("adaptiveFormats") ?: return@runCatching null
        var bestUrl: String? = null
        var bestBitrate = Long.MIN_VALUE
        for (i in 0 until formats.length()) {
            val item = formats.optJSONObject(i) ?: continue
            val type = item.optString("type", "")
            if (!type.startsWith("audio/")) continue
            val url = PlaybackSourceRegistry.validateHttpsUrl(item.optString("url", "")) ?: continue
            val bitrate = item.optString("bitrate", "").toLongOrNull() ?: item.optLong("bitrate", 0L)
            if (bestUrl == null || bitrate > bestBitrate) {
                bestUrl = url
                bestBitrate = bitrate
            }
        }
        bestUrl
    }.getOrNull()

    private fun resolveWithBundle(bundle: ResolverBundleRepository.Bundle, videoId: String): BundleResolveResult {
        val engine = resolverEngine ?: return BundleResolveResult.Transient("engine_missing")
        val future = engine.resolveDetailed(bundle, videoId, RESOLVER_TIMEOUT_MS)
        val outcome = try {
            future.get(RESOLVER_TIMEOUT_MS + 1_000L, TimeUnit.MILLISECONDS)
        } catch (e: InterruptedException) {
            future.cancel(false)
            Thread.currentThread().interrupt()
            throw e
        } catch (_: Exception) {
            future.cancel(false)
            return BundleResolveResult.Transient("timeout")
        }
        return when (outcome) {
            is ResolveOutcome.Success -> {
                val url = pickBestAudioUrl(outcome.json)
                if (url != null) BundleResolveResult.Resolved(url)
                else BundleResolveResult.Fault("no_valid_audio_url")
            }
            is ResolveOutcome.TransientFailure -> BundleResolveResult.Transient(outcome.reason)
            is ResolveOutcome.CandidateFault -> BundleResolveResult.Fault(outcome.reason)
        }
    }

    private inner class PlaybackResolvingDataSource(
        private val upstream: DefaultHttpDataSource,
    ) : DataSource {
        private var currentUri: Uri? = null

        override fun addTransferListener(transferListener: TransferListener) {
            upstream.addTransferListener(transferListener)
        }

        override fun open(dataSpec: DataSpec): Long {
            upstream.clearAllRequestProperties()
            val scheme = dataSpec.uri.scheme
            if (scheme != PlaybackSourceRegistry.RESOLVE_SCHEME &&
                scheme != PlaybackSourceRegistry.LEGACY_TRACK_SCHEME) {
                currentUri = dataSpec.uri
                return upstream.open(dataSpec)
            }

            if (scheme == PlaybackSourceRegistry.LEGACY_TRACK_SCHEME) {
                val videoId = dataSpec.uri.lastPathSegment
                    ?: throw TerminalPlaybackIOException("Missing track ID")
                val legacyProxy = dataSpec.uri.getQueryParameter("proxy")
                return resolveYouTubeAndOpen(dataSpec, videoId, queueId = null, generation = null, legacyProxy = legacyProxy)
            }

            val queueId = dataSpec.uri.lastPathSegment
                ?: throw TerminalPlaybackIOException("Missing queueId")
            val target = registry.lookupTarget(queueId)
                ?: throw TerminalPlaybackIOException("Queue entry no longer active")
            registry.setActiveQueueId(target.queueId)

            val preResolved = target.source
            if (preResolved != null) {
                try {
                    val spec = buildResolvedSpec(dataSpec, preResolved.url, preResolved.headers)
                    val length = upstream.open(spec)
                    currentUri = upstream.uri ?: spec.uri
                    registry.resetRetryBudget(target.queueId, target.generation)
                    return length
                } catch (e: IOException) {
                    closeQuietly(upstream)
                    registry.invalidateSource(target.queueId, target.generation, preResolved.url)
                    if (!registry.tryConsumeRetry(target.queueId, target.generation)) {
                        throw TerminalPlaybackIOException("Stream load failed after retry budget exhausted", e)
                    }
                    Log.w(TAG, "Pre-resolved stream open failed for queueId=${target.queueId}; attempting bounded fallback")
                }
            }

            val resolverKey = target.resolverKey
            if (resolverKey?.provider == "jiosaavn") {
                return resolveJioSaavnAndOpen(
                    originalSpec = dataSpec,
                    trackId = resolverKey.trackId,
                    queueId = target.queueId,
                    generation = target.generation,
                )
            }
            if (resolverKey != null && resolverKey.provider != "youtube") {
                throw TerminalPlaybackIOException("No active source for provider ${resolverKey.provider}")
            }
            val videoId = resolverKey?.trackId
                ?: throw TerminalPlaybackIOException("Missing track ID for queueId=${target.queueId}")

            return resolveYouTubeAndOpen(
                originalSpec = dataSpec,
                videoId = videoId,
                queueId = target.queueId,
                generation = target.generation,
                legacyProxy = target.legacyProxy,
            )
        }

        private fun resolveJioSaavnAndOpen(
            originalSpec: DataSpec,
            trackId: String,
            queueId: String,
            generation: Long?,
        ): Long {
            val streamUrl = buildJioSaavnStreamUrl(BuildConfig.JIOSAAVN_AUDIO_ORIGIN, trackId)
                ?: throw TerminalPlaybackIOException("JioSaavn audio origin or track ID is invalid")
            val spec = buildResolvedSpec(originalSpec, streamUrl, emptyMap())
            return try {
                val length = upstream.open(spec)
                currentUri = upstream.uri ?: spec.uri
                registry.cacheNativeResolvedSource(
                    queueId = queueId,
                    generation = generation,
                    resolverKey = ResolverKey("jiosaavn", trackId),
                    url = streamUrl,
                )
                registry.resetRetryBudget(queueId, generation)
                length
            } catch (e: IOException) {
                closeQuietly(upstream)
                if (!registry.hasRetryRemaining(queueId, generation)) {
                    throw TerminalPlaybackIOException("JioSaavn stream load failed after retry budget exhausted", e)
                }
                throw e
            }
        }

        private fun resolveYouTubeAndOpen(
            originalSpec: DataSpec,
            videoId: String,
            queueId: String?,
            generation: Long?,
            legacyProxy: String?,
        ): Long {
            if (!PlaybackSourceRegistry.YOUTUBE_ID_REGEX.matches(videoId)) {
                throw TerminalPlaybackIOException("Invalid YouTube track ID")
            }

            var lastError: Exception? = null
            var candidateFaultVersion: Long? = null
            var candidateNeedsFallbackConfirmation = false

            val repo = resolverRepo
            val engine = resolverEngine
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && repo != null && engine != null && engine.isSupported()) {
                refreshExecutor?.execute { runCatching { repo.refresh() } }
                val primaryBundle = repo.load(includeCandidate = true)
                val goodBundle = repo.load(includeCandidate = false)
                val primaryIsCandidate = primaryBundle != null && primaryBundle.version != goodBundle?.version
                if (primaryBundle != null) {
                    when (val primaryResult = resolveWithBundle(primaryBundle, videoId)) {
                        is BundleResolveResult.Resolved -> {
                            try {
                                val spec = buildResolvedSpec(originalSpec, primaryResult.url, emptyMap())
                                val length = upstream.open(spec)
                                currentUri = upstream.uri ?: spec.uri
                                repo.promote(primaryBundle.version)
                                if (queueId != null) {
                                    registry.cacheNativeResolvedSource(
                                        queueId = queueId,
                                        generation = generation,
                                        resolverKey = ResolverKey("youtube", videoId),
                                        url = primaryResult.url,
                                    )
                                    registry.resetRetryBudget(queueId, generation)
                                }
                                return length
                            } catch (e: IOException) {
                                closeQuietly(upstream)
                                lastError = e
                                if (primaryIsCandidate && e is HttpDataSource.InvalidResponseCodeException &&
                                    e.responseCode in setOf(401, 403, 404, 410)) {
                                    candidateFaultVersion = primaryBundle.version
                                    candidateNeedsFallbackConfirmation = true
                                }
                            }
                        }
                        is BundleResolveResult.Fault -> {
                            if (primaryIsCandidate) {
                                candidateFaultVersion = primaryBundle.version
                                candidateNeedsFallbackConfirmation = goodBundle == null
                            }
                        }
                        is BundleResolveResult.Transient -> {
                            // Never quarantine a candidate on transient/offline/timeout/busy failures.
                        }
                    }

                    if (goodBundle != null && goodBundle.version != primaryBundle.version) {
                        val lkgResult = resolveWithBundle(goodBundle, videoId)
                        if (lkgResult is BundleResolveResult.Resolved) {
                            try {
                                val spec = buildResolvedSpec(originalSpec, lkgResult.url, emptyMap())
                                val length = upstream.open(spec)
                                currentUri = upstream.uri ?: spec.uri
                                candidateFaultVersion?.let { repo.recordFailure(it, fallbackSucceeded = true) }
                                if (queueId != null) {
                                    registry.cacheNativeResolvedSource(
                                        queueId = queueId,
                                        generation = generation,
                                        resolverKey = ResolverKey("youtube", videoId),
                                        url = lkgResult.url,
                                    )
                                    registry.resetRetryBudget(queueId, generation)
                                }
                                return length
                            } catch (e: IOException) {
                                closeQuietly(upstream)
                                lastError = e
                            }
                        }
                    }
                }
            }

            val fallbackUrl = try {
                StreamExtractorPlugin.ensureInitialized()
                StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
                    .audioStreams
                    .filter { it.isUrl && PlaybackSourceRegistry.validateHttpsUrl(it.content) != null }
                    .maxByOrNull { it.averageBitrate }
                    ?.content
            } catch (e: Exception) {
                lastError = e
                null
            } ?: runCatching { resolveFromProxy(legacyProxy, videoId) }.getOrNull()

            if (fallbackUrl != null) {
                try {
                    val spec = buildResolvedSpec(originalSpec, fallbackUrl, emptyMap())
                    val length = upstream.open(spec)
                    currentUri = upstream.uri ?: spec.uri
                    if (repo != null) {
                        candidateFaultVersion?.let { repo.recordFailure(it, fallbackSucceeded = true) }
                    }
                    if (queueId != null) {
                        registry.cacheNativeResolvedSource(
                            queueId = queueId,
                            generation = generation,
                            resolverKey = ResolverKey("youtube", videoId),
                            url = fallbackUrl,
                        )
                        registry.resetRetryBudget(queueId, generation)
                    }
                    return length
                } catch (e: IOException) {
                    closeQuietly(upstream)
                    if (repo != null && candidateFaultVersion != null && !candidateNeedsFallbackConfirmation) {
                        repo.recordFailure(candidateFaultVersion, fallbackSucceeded = false)
                    }
                    throw TerminalPlaybackIOException("Could not open fallback audio stream", e)
                }
            }

            if (repo != null && candidateFaultVersion != null && !candidateNeedsFallbackConfirmation) {
                repo.recordFailure(candidateFaultVersion, fallbackSucceeded = false)
            }
            throw TerminalPlaybackIOException("Could not resolve the audio stream", lastError)
        }

        private fun buildResolvedSpec(
            original: DataSpec,
            url: String,
            headers: Map<String, String>,
        ): DataSpec {
            val merged = LinkedHashMap<String, String>()
            if (original.httpRequestHeaders.isNotEmpty()) {
                merged.putAll(original.httpRequestHeaders)
            }
            if (headers.isNotEmpty()) {
                merged.putAll(headers)
            }
            // Media3 DefaultHttpDataSource owns byte-range headers via DataSpec.position/length.
            merged.keys.removeAll { it.equals("Range", ignoreCase = true) }
            return original.buildUpon()
                .setUri(Uri.parse(url))
                .setHttpRequestHeaders(merged)
                .build()
        }

        private fun closeQuietly(source: DataSource) {
            runCatching { source.close() }
            upstream.clearAllRequestProperties()
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            upstream.read(buffer, offset, length)

        override fun getUri(): Uri? = currentUri ?: upstream.uri

        override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

        override fun close() {
            currentUri = null
            try {
                upstream.close()
            } finally {
                upstream.clearAllRequestProperties()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasHeadlessResolverConfig()) {
            val keys = parsePinnedKeys(BuildConfig.RESOLVER_V2_PUBLIC_KEYS)
            val manifestUrl = parseManifestUrl(BuildConfig.RESOLVER_V2_MANIFEST_URL)
            if (keys.isNotEmpty() && manifestUrl != null) {
                resolverRepo = ResolverBundleRepository(
                    directory = File(noBackupFilesDir, "resolver-v2"),
                    pinnedKeys = keys,
                    manifestUrl = manifestUrl,
                )
                resolverEngine = ResolverEngine(applicationContext)
                refreshExecutor = Executors.newSingleThreadExecutor { task ->
                    Thread(task, "m14u-resolver-refresh")
                }
            }
        }

        val httpFactory = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(8_000)
            .setReadTimeoutMs(8_000)

        // Runs on the native loader thread, including when the WebView is suspended.
        val dataSourceFactory = DataSource.Factory {
            PlaybackResolvingDataSource(httpFactory.createDataSource())
        }

        val loadErrorHandlingPolicy = createLoadErrorHandlingPolicy(registry)

        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(
                ProgressiveMediaSource.Factory(dataSourceFactory)
                    .setLoadErrorHandlingPolicy(loadErrorHandlingPolicy)
            )
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
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                registry.setActiveQueueId(mediaItem?.mediaId)
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    player.setPauseAtEndOfMediaItems(false)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "Playback error code=${error.errorCodeName}")
            }
        })
        val artworkLoader = DataSourceBitmapLoader(
            DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE.get(),
            DefaultHttpDataSource.Factory().setConnectTimeoutMs(3000).setReadTimeoutMs(3000), null, 1024)
        session = MediaSession.Builder(this, player).setCallback(callback).setSessionActivity(activity)
            .setBitmapLoader(CacheBitmapLoader(MediaArtworkLoader(artworkLoader))).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        refreshExecutor?.shutdownNow()
        refreshExecutor = null
        resolverEngine?.close()
        resolverEngine = null
        resolverRepo = null
        registry.clear()
        session?.let {
            it.player.release()
            it.release()
        }
        session = null
        super.onDestroy()
    }
}
