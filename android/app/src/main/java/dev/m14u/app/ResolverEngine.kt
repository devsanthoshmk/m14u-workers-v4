package dev.m14u.app

import android.content.Context
import android.os.Build
import android.os.SystemClock
import androidx.javascriptengine.DataInputException
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.IsolateTerminatedException
import androidx.javascriptengine.JavaScriptException
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import androidx.javascriptengine.MemoryLimitExceededException
import androidx.javascriptengine.SandboxDeadException
import androidx.javascriptengine.SandboxUnsupportedException
import com.google.common.util.concurrent.ListenableFuture
import com.google.gson.JsonParser
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.Base64
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Future
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal sealed class ResolveOutcome {
    data class Success(val json: String) : ResolveOutcome()
    data class TransientFailure(val reason: String) : ResolveOutcome()
    data class CandidateFault(val reason: String) : ResolveOutcome()
}

/** Start only when playback needs resolution. Wait on the Media3 loader, never the main thread. */
internal class ResolverEngine(context: Context) : AutoCloseable {
    private val api = if (Build.VERSION.SDK_INT >= 26) Runtime(context.applicationContext) else null

    fun isSupported(): Boolean = api?.isSupported() == true

    /** Returns resolver JSON or null. Only pass a repository-verified bundle, never a bridge input. */
    fun resolve(bundle: ResolverBundleRepository.Bundle, videoId: String, timeoutMs: Long = 12_000L): Future<String?>? =
        api?.resolve(bundle, videoId, timeoutMs)

    /** Returns a classified outcome distinguishing transient/offline failures from candidate faults. */
    fun resolveDetailed(
        bundle: ResolverBundleRepository.Bundle,
        videoId: String,
        timeoutMs: Long = 12_000L,
    ): Future<ResolveOutcome> = api?.resolveDetailed(bundle, videoId, timeoutMs)
        ?: CompletableFuture.completedFuture(ResolveOutcome.TransientFailure("api_below_26"))

    override fun close() { api?.close() }

    @androidx.annotation.RequiresApi(26)
    private class Runtime(private val context: Context) : AutoCloseable {
        private val executor = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(1), { task -> Thread(task, "m14u-resolver") })
        private val broker = ResolverHttpBroker()
        private val sandboxLock = Any()
        private var sandbox: JavaScriptSandbox? = null
        private var activeIsolate: JavaScriptIsolate? = null
        private var activeConnection: ListenableFuture<JavaScriptSandbox>? = null
        @Volatile private var closed = false

        fun isSupported() = !closed && runCatching { JavaScriptSandbox.isSupported() }.getOrDefault(false)

        @Synchronized
        fun resolve(bundle: ResolverBundleRepository.Bundle, videoId: String, timeoutMs: Long = 12_000L): Future<String?>? {
            if (closed || !VIDEO_ID.matches(videoId) || !isSupported()) return null
            val detailed = try {
                submitDetailed(bundle, videoId, timeoutMs)
            } catch (_: RejectedExecutionException) {
                return null
            }
            return object : Future<String?> {
                override fun cancel(mayInterruptIfRunning: Boolean) = detailed.cancel(mayInterruptIfRunning)
                override fun isCancelled() = detailed.isCancelled
                override fun isDone() = detailed.isDone
                override fun get(): String? = (detailed.get() as? ResolveOutcome.Success)?.json
                override fun get(timeout: Long, unit: TimeUnit): String? =
                    (detailed.get(timeout, unit) as? ResolveOutcome.Success)?.json
            }
        }

        @Synchronized
        fun resolveDetailed(
            bundle: ResolverBundleRepository.Bundle,
            videoId: String,
            timeoutMs: Long = 12_000L,
        ): Future<ResolveOutcome> {
            if (closed) return CompletableFuture.completedFuture(ResolveOutcome.TransientFailure("engine_closed"))
            if (!VIDEO_ID.matches(videoId)) {
                return CompletableFuture.completedFuture(ResolveOutcome.TransientFailure("invalid_video_id"))
            }
            if (!isSupported()) {
                return CompletableFuture.completedFuture(ResolveOutcome.TransientFailure("sandbox_unsupported"))
            }
            return try {
                submitDetailed(bundle, videoId, timeoutMs)
            } catch (_: RejectedExecutionException) {
                CompletableFuture.completedFuture(
                    ResolveOutcome.TransientFailure(if (closed) "engine_closed" else "executor_busy"),
                )
            }
        }

        private fun submitDetailed(
            bundle: ResolverBundleRepository.Bundle,
            videoId: String,
            timeoutMs: Long,
        ): Future<ResolveOutcome> {
            val deadline = SystemClock.elapsedRealtime() + timeoutMs.coerceAtLeast(1L)
            executor.purge()
            return executor.submit<ResolveOutcome> {
                if (closed) return@submit ResolveOutcome.TransientFailure("engine_closed")
                val outcome = runAttempt(bundle.code, videoId, deadline)
                if (outcome !is ResolveOutcome.Success && shouldResetSandbox(outcome, closed)) {
                    resetSandbox()
                }
                outcome
            }
        }

        private fun runAttempt(code: String, videoId: String, deadline: Long): ResolveOutcome {
            val existing = synchronized(sandboxLock) {
                if (closed) return ResolveOutcome.TransientFailure("engine_closed")
                sandbox
            }
            val service = try {
                existing ?: connect(deadline)
            } catch (_: EngineClosedException) {
                return ResolveOutcome.TransientFailure("engine_closed")
            } catch (_: TimeoutException) {
                return ResolveOutcome.TransientFailure("sandbox_connect_timeout")
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return ResolveOutcome.TransientFailure("interrupted")
            } catch (exception: Exception) {
                return if (unwrapThrowable(exception) is SandboxUnsupportedException) {
                    ResolveOutcome.TransientFailure("sandbox_unsupported")
                } else {
                    ResolveOutcome.TransientFailure("sandbox_connect_failed")
                }
            }
            if (!FEATURES.all(service::isFeatureSupported)) {
                return ResolveOutcome.TransientFailure("sandbox_features_unsupported")
            }
            val parameters = IsolateStartupParameters().apply {
                setMaxHeapSizeBytes(64L * 1024 * 1024)
                setMaxEvaluationReturnSizeBytes(512 * 1024)
            }
            val isolate = try {
                service.createIsolate(parameters)
            } catch (_: Exception) {
                if (closed) return ResolveOutcome.TransientFailure("engine_closed")
                resetSandbox()
                val reconnected = try {
                    connect(deadline)
                } catch (_: EngineClosedException) {
                    return ResolveOutcome.TransientFailure("engine_closed")
                } catch (_: TimeoutException) {
                    return ResolveOutcome.TransientFailure("sandbox_connect_timeout")
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return ResolveOutcome.TransientFailure("interrupted")
                } catch (_: Exception) {
                    return ResolveOutcome.TransientFailure("sandbox_reconnect_failed")
                }
                if (!FEATURES.all(reconnected::isFeatureSupported)) {
                    return ResolveOutcome.TransientFailure("sandbox_features_unsupported")
                }
                try {
                    reconnected.createIsolate(parameters)
                } catch (_: Exception) {
                    return ResolveOutcome.TransientFailure("isolate_create_failed")
                }
            }
            synchronized(sandboxLock) {
                if (closed) {
                    runCatching { isolate.close() }
                    return ResolveOutcome.TransientFailure("engine_closed")
                }
                activeIsolate = isolate
            }
            return try {
                run(isolate, code, videoId, deadline)
            } finally {
                synchronized(sandboxLock) {
                    if (activeIsolate === isolate) activeIsolate = null
                }
                runCatching { isolate.close() }
            }
        }

        private fun connect(deadline: Long): JavaScriptSandbox {
            synchronized(sandboxLock) {
                if (closed) throw EngineClosedException()
            }
            val connection = JavaScriptSandbox.createConnectedInstanceAsync(context)
            var abortImmediately = false
            synchronized(sandboxLock) {
                if (closed) abortImmediately = true else activeConnection = connection
            }
            if (abortImmediately) {
                closeWhenReady(connection)
                throw EngineClosedException()
            }
            return try {
                val connected = connection.get(remaining(deadline).coerceAtMost(5_000), TimeUnit.MILLISECONDS)
                var rejectAfterConnect = false
                synchronized(sandboxLock) {
                    if (activeConnection === connection) activeConnection = null
                    if (closed) rejectAfterConnect = true else sandbox = connected
                }
                if (rejectAfterConnect) {
                    runCatching { connected.close() }
                    throw EngineClosedException()
                }
                connected
            } catch (exception: Exception) {
                synchronized(sandboxLock) {
                    if (activeConnection === connection) activeConnection = null
                }
                closeWhenReady(connection)
                throw exception
            }
        }

        private fun closeWhenReady(connection: ListenableFuture<JavaScriptSandbox>) {
            connection.addListener({ runCatching { connection.get().close() } }, { it.run() })
        }

        private fun run(isolate: JavaScriptIsolate, code: String, videoId: String, deadline: Long): ResolveOutcome {
            fun evaluate(source: String) = isolate.evaluateJavaScriptAsync(source)
                .get(remaining(deadline), TimeUnit.MILLISECONDS)
            var sawNetworkIoFailure = false
            var sawUpstreamHttpFailure = false
            var sawDisallowedRequest = false
            return try {
                evaluate("$code\n;'ready'")
                if (evaluate("m14uResolver.start(${JSONObject.quote(videoId)})") != "ok") {
                    return ResolveOutcome.CandidateFault("invalid_start_reply")
                }
                var requestsServed = 0
                val ids = mutableSetOf<Int>()
                var responseBytes = 0
                repeat(500) {
                    val frame = JSONObject(evaluate("m14uResolver.drain()"))
                    if (frame.getBoolean("done")) {
                        val resultObj = frame.optJSONObject("result")
                        if (resultObj != null) {
                            val json = resultObj.toString()
                            return if (isValidResolverOutputJson(json)) {
                                ResolveOutcome.Success(json)
                            } else {
                                ResolveOutcome.CandidateFault("malformed_or_empty_result")
                            }
                        }
                        return classifyEmptyResult(
                            sawDisallowedRequest = sawDisallowedRequest,
                            sawNetworkIoFailure = sawNetworkIoFailure,
                            sawUpstreamHttpFailure = sawUpstreamHttpFailure,
                        )
                    }
                    val requests = frame.getJSONArray("requests")
                    check(requests.length() <= 4)
                    if (requests.length() == 0) Thread.sleep(remaining(deadline).coerceAtMost(20))
                    for (index in 0 until requests.length()) {
                        check(++requestsServed <= 12)
                        val request = requests.getJSONObject(index)
                        val id = request.getInt("id")
                        check(id in 1..12 && ids.add(id))
                        val reply = try {
                            broker.fetchDetailed(request, remaining(deadline)).let { fetched ->
                                responseBytes += fetched.bytes.size
                                if (fetched.status == 429 || fetched.status >= 500) {
                                    sawUpstreamHttpFailure = true
                                }
                                fetched.bytes
                            }
                        } catch (_: BrokerTransientException) {
                            sawUpstreamHttpFailure = true
                            NULL_REPLY
                        } catch (_: IOException) {
                            sawNetworkIoFailure = true
                            NULL_REPLY
                        } catch (_: IllegalArgumentException) {
                            sawDisallowedRequest = true
                            NULL_REPLY
                        }
                        check(responseBytes <= 12_000_000)
                        val name = "response$id"
                        isolate.provideNamedData(name, reply)
                        if (evaluate("m14uResolver.reply($id,${JSONObject.quote(name)})") != "ok") {
                            return ResolveOutcome.CandidateFault("invalid_reply_ack")
                        }
                    }
                }
                ResolveOutcome.TransientFailure("pump_limit_exceeded")
            } catch (exception: Exception) {
                if (exception is InterruptedException) Thread.currentThread().interrupt()
                classifyExecutionException(exception, closed)
            }
        }

        private fun resetSandbox() {
            val current = synchronized(sandboxLock) {
                sandbox.also { sandbox = null }
            }
            current?.let { runCatching { it.close() } }
        }

        @Synchronized
        override fun close() {
            if (closed) return
            closed = true
            val queued = executor.queue.toList()
            executor.purge()
            queued.forEach { (it as? Future<*>)?.cancel(false) }
            val currentIsolate: JavaScriptIsolate?
            val currentSandbox: JavaScriptSandbox?
            val currentConnection: ListenableFuture<JavaScriptSandbox>?
            synchronized(sandboxLock) {
                currentIsolate = activeIsolate
                activeIsolate = null
                currentSandbox = sandbox
                sandbox = null
                currentConnection = activeConnection
                activeConnection = null
            }
            executor.shutdownNow()
            broker.cancel()
            currentIsolate?.let { runCatching { it.close() } }
            currentSandbox?.let { runCatching { it.close() } }
            currentConnection?.let(::closeWhenReady)
        }

        private class EngineClosedException : RuntimeException()

        private companion object {
            val VIDEO_ID = Regex("[A-Za-z0-9_-]{11}")
            val NULL_REPLY = "null".toByteArray()
            val FEATURES = listOf(JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,
                JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT,
                JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
                JavaScriptSandbox.JS_FEATURE_WASM_COMPILATION,
                JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE,
                JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION)

            fun remaining(deadline: Long): Long = (deadline - SystemClock.elapsedRealtime()).also {
                if (it <= 0) throw TimeoutException("Resolver deadline")
            }
        }
    }
}

internal fun unwrapThrowable(error: Throwable): Throwable {
    var current = error
    while (current is ExecutionException && current.cause != null) {
        current = current.cause!!
    }
    return current
}

internal fun classifyEmptyResult(
    sawDisallowedRequest: Boolean,
    sawNetworkIoFailure: Boolean,
    sawUpstreamHttpFailure: Boolean,
): ResolveOutcome = when {
    sawDisallowedRequest -> ResolveOutcome.CandidateFault("disallowed_broker_request")
    sawNetworkIoFailure -> ResolveOutcome.TransientFailure("network_io_error")
    sawUpstreamHttpFailure -> ResolveOutcome.TransientFailure("upstream_http_error")
    else -> ResolveOutcome.CandidateFault("empty_result")
}

internal fun classifyExecutionException(error: Throwable, engineClosed: Boolean): ResolveOutcome {
    if (engineClosed) return ResolveOutcome.TransientFailure("engine_closed")
    if (error is InterruptedException) return ResolveOutcome.TransientFailure("interrupted")
    if (error is TimeoutException) return ResolveOutcome.TransientFailure("timeout")
    return when (unwrapThrowable(error)) {
        is InterruptedException -> ResolveOutcome.TransientFailure("interrupted")
        is TimeoutException -> ResolveOutcome.TransientFailure("timeout")
        is SandboxUnsupportedException -> ResolveOutcome.TransientFailure("sandbox_unsupported")
        is MemoryLimitExceededException -> ResolveOutcome.CandidateFault("isolate_memory_limit")
        is IsolateTerminatedException, is SandboxDeadException -> ResolveOutcome.CandidateFault("isolate_crashed")
        is DataInputException -> ResolveOutcome.CandidateFault("invalid_js_input")
        is JavaScriptException -> ResolveOutcome.CandidateFault("js_exception")
        is JSONException, is IllegalStateException -> ResolveOutcome.CandidateFault("invalid_protocol_output")
        else -> ResolveOutcome.TransientFailure("execution_failed")
    }
}

internal fun shouldResetSandbox(outcome: ResolveOutcome, engineClosed: Boolean): Boolean {
    if (engineClosed || outcome is ResolveOutcome.CandidateFault) return true
    if (outcome is ResolveOutcome.TransientFailure) {
        return outcome.reason in setOf("timeout", "interrupted", "pump_limit_exceeded", "execution_failed", "engine_closed")
    }
    return false
}

internal fun isValidResolverOutputJson(json: String): Boolean = runCatching {
    val root = JsonParser.parseString(json)
    if (!root.isJsonObject) return@runCatching false
    val formats = root.asJsonObject.get("adaptiveFormats")
    if (formats == null || !formats.isJsonArray || formats.asJsonArray.size() == 0) return@runCatching false
    formats.asJsonArray.any { element ->
        if (!element.isJsonObject) return@any false
        val obj = element.asJsonObject
        val rawUrl = obj.get("url")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
            ?: return@any false
        val mime = obj.get("type")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
            ?: return@any false
        val url = rawUrl.toHttpUrlOrNull() ?: return@any false
        url.isHttps && url.host.endsWith(".googlevideo.com") && mime.startsWith("audio/")
    }
}.getOrDefault(false)

internal class BrokerTransientException(message: String, cause: Throwable? = null) : IOException(message, cause)

internal fun validateUpstreamResponse(
    statusCode: Int,
    mime: String,
    contentLength: Long,
    maxResponse: Int,
    allowedMimes: Set<String>,
) {
    if (statusCode in 300..399) throw BrokerTransientException("Upstream redirect ($statusCode)")
    if (mime !in allowedMimes) throw BrokerTransientException("Unexpected upstream MIME ($mime)")
    if (contentLength > maxResponse) throw BrokerTransientException("Upstream response exceeds limit")
}

internal fun readBoundedUpstream(stream: java.io.InputStream, maxResponse: Int): ByteArray = try {
    stream.readBounded(maxResponse)
} catch (error: IllegalArgumentException) {
    throw BrokerTransientException("Upstream response exceeds limit", error)
}

@androidx.annotation.RequiresApi(26)
private class ResolverHttpBroker {
    data class FetchedReply(val status: Int, val bytes: ByteArray)

    private val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).followRedirects(false)
        .followSslRedirects(false).retryOnConnectionFailure(false)
        .dns(object : Dns {
          override fun lookup(hostname: String): List<InetAddress> {
            val host = hostname
            if (host !in HOSTS) throw UnknownHostException("Resolver host denied")
            return Dns.SYSTEM.lookup(host).also { addresses ->
                if (addresses.isEmpty() || !addresses.all(::publicAddress)) throw UnknownHostException("Resolver address denied")
            }
          }
        }).build()

    fun cancel() = client.dispatcher.cancelAll()

    fun fetchDetailed(message: JSONObject, remaining: Long): FetchedReply {
        val raw = message.getString("url")
        require(raw.length <= 4096 && '\\' !in raw && '@' !in raw.substringAfter("://").substringBefore('/'))
        val url = requireNotNull(raw.toHttpUrlOrNull())
        require(url.isHttps && url.port == 443 && url.host in HOSTS && url.username.isEmpty() &&
            url.password.isEmpty() && url.fragment == null)
        val method = message.getString("method")
        val path = url.encodedPath
        require((method == "GET" && url.host == "www.youtube.com" &&
            (path == "/iframe_api" || PLAYER_PATH.matches(path))) ||
            (method == "POST" && path in setOf("/youtubei/v1/visitor_id", "/youtubei/v1/player", "/youtubei/v1/next")))
        val body = if (message.isNull("body")) null else message.getString("body").toByteArray()
        require(if (method == "GET") body == null else body != null && body.size <= 128 * 1024)
        val request = Request.Builder().url(url).method(method, body?.toRequestBody()).apply {
            val headers = message.getJSONObject("headers")
            for (name in HEADERS) {
                if (headers.has(name)) {
                    val value = headers.getString(name)
                    require(value.length <= 1024 && value.all { it in ' '..'~' })
                    header(name, value)
                }
            }
        }.build()
        val call = client.newCall(request)
        call.timeout().timeout(remaining.coerceAtMost(5000), TimeUnit.MILLISECONDS)
        return call.execute().use { response ->
            val payload = response.body ?: throw BrokerTransientException("Empty upstream response body")
            val type = payload.contentType()
            val mime = if (type == null) "" else "${type.type}/${type.subtype}"
            validateUpstreamResponse(response.code, mime, payload.contentLength(), MAX_RESPONSE, MIME)
            val bytes = payload.byteStream().use { readBoundedUpstream(it, MAX_RESPONSE) }
            val replyBytes = JSONObject().put("status", response.code).put("type", mime)
                .put("body", Base64.getEncoder().encodeToString(bytes)).toString().toByteArray()
            FetchedReply(response.code, replyBytes)
        }
    }

    private companion object {
        val HOSTS = setOf("www.youtube.com", "youtubei.googleapis.com")
        val PLAYER_PATH = Regex("/s/player/[A-Za-z0-9_-]{1,64}/player_ias\\.vflset/en_US/base\\.js")
        val HEADERS = setOf("accept", "accept-language", "content-type", "user-agent", "x-youtube-client-name",
            "x-youtube-client-version", "x-goog-visitor-id", "x-goog-api-format-version")
        val MIME = setOf("application/json", "application/javascript", "text/javascript", "application/x-javascript")
        const val MAX_RESPONSE = 4_500_000

        fun publicAddress(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress) return false
            val octets = address.address.map { it.toInt() and 255 }
            val (a, b, c) = octets
            if (octets.size == 4) return a in 1..223 && a != 127 &&
                !(a == 100 && b in 64..127 || a == 192 && (b == 0 && c in setOf(0, 2) || b == 88 && c == 99) ||
                    a == 198 && (b in 18..19 || b == 51 && c == 100) || a == 203 && b == 0 && c == 113)
            return a in 0x20..0x3f && !(a == 0x20 && (b == 2 || b == 1 && (c < 2 || c == 0x0d && octets[3] == 0xb8)))
        }
    }
}
