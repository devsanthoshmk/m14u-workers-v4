package dev.m14u.app

import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.StringReader
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption.READ
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit

internal const val RESOLVER_MAX_BYTES = 3_000_000
internal const val RESOLVER_MANIFEST_LIMIT = 4096

internal class ResolverBundleTrust(private val keys: Map<String, String>) {
    data class Manifest(val version: Long, val abi: String, val keyId: String, val artifactPath: String,
        val byteLength: Int, val sha256Hex: String, val signature: String) {
        fun signedBytes() = listOf("m14u-resolver-v2", version, abi, keyId, artifactPath, byteLength, sha256Hex)
            .joinToString("\n").toByteArray(Charsets.UTF_8)
    }

    fun verifyManifest(bytes: ByteArray): Manifest {
        require(bytes.size in 1..RESOLVER_MANIFEST_LIMIT)
        val fields = mutableMapOf<String, String>()
        JsonReader(StringReader(bytes.decodeToString(throwOnInvalidSequence = true))).use { reader ->
            reader.strictness = Strictness.STRICT
            reader.beginObject()
            while (reader.hasNext()) {
                val name = reader.nextName()
                val expected = when (name) {
                    "version", "byteLength" -> JsonToken.NUMBER
                    "abi", "keyId", "artifactPath", "sha256Hex", "signature" -> JsonToken.STRING
                    else -> error("Unknown manifest field")
                }
                require(reader.peek() == expected && name !in fields)
                fields[name] = reader.nextString()
            }
            reader.endObject()
            require(reader.peek() == JsonToken.END_DOCUMENT && fields.size == 7)
        }
        fun integer(name: String): Long = fields.getValue(name).also {
            require(it.matches(Regex("[1-9][0-9]{0,15}")))
        }.toLong()
        val version = integer("version")
        val length = integer("byteLength")
        val m = Manifest(version, fields.getValue("abi"), fields.getValue("keyId"), fields.getValue("artifactPath"),
            length.toInt(), fields.getValue("sha256Hex"), fields.getValue("signature"))
        require(version <= 9_007_199_254_740_991L && length in 1..RESOLVER_MAX_BYTES.toLong())
        require(m.abi == "androidx-js-1" && m.artifactPath == "/resolvers/v2/$version/resolver.js")
        require(m.keyId.matches(Regex("[A-Za-z0-9_-]{1,48}")) && m.sha256Hex.matches(Regex("[0-9a-f]{64}")))
        val decoder = Base64.getDecoder()
        val pinned = keys[m.keyId] ?: error("Unpinned key")
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decoder.decode(pinned)))
            as java.security.interfaces.ECPublicKey
        val p256 = java.security.AlgorithmParameters.getInstance("EC").apply {
            init(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(java.security.spec.ECParameterSpec::class.java)
        require(key.params.curve == p256.curve && key.params.generator == p256.generator &&
            key.params.order == p256.order && key.params.cofactor == p256.cofactor)
        require(Signature.getInstance("SHA256withECDSA").apply {
            initVerify(key)
            update(m.signedBytes())
        }.verify(p1363ToDer(decoder.decode(m.signature))))
        return m
    }

    fun verifyCode(m: Manifest, bytes: ByteArray) {
        require(bytes.size == m.byteLength)
        require(MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } == m.sha256Hex)
        bytes.decodeToString(throwOnInvalidSequence = true)
    }

    private fun p1363ToDer(raw: ByteArray): ByteArray {
        require(raw.size == 64)
        fun integer(offset: Int): ByteArray {
            val bytes = raw.copyOfRange(offset, offset + 32)
            val start = bytes.indexOfFirst { it != 0.toByte() }.coerceAtLeast(0)
            val magnitude = bytes.copyOfRange(start, 32)
            val value = if (magnitude[0] < 0) byteArrayOf(0) + magnitude else magnitude
            return byteArrayOf(2, value.size.toByte()) + value
        }
        val body = integer(0) + integer(32)
        return byteArrayOf(0x30, body.size.toByte()) + body
    }
}

/** One service-owned instance rooted in noBackupFilesDir; no network IO on playback or UI threads. API 26+. */
internal class ResolverBundleRepository(
    private val directory: File,
    pinnedKeys: Map<String, String>,
    private val manifestUrl: HttpUrl = "https://m14u.pages.dev/resolvers/v2/manifest.json".toHttpUrl(),
    private val baseline: Pair<ByteArray, ByteArray>? = null,
    private val clockMs: () -> Long = { System.nanoTime() / 1_000_000 },
    private val download: (HttpUrl, Int, Set<String>) -> ByteArray = ::downloadResolverBytes,
    private val atomicWrite: (File, ByteArray) -> Unit = ::writeResolverAtomically,
) {
    data class Bundle(val version: Long, val code: String)
    private data class State(val high: Long = 0, val good: Long = 0, val candidate: Long = 0, val faults: Int = 0)
    private val trust = ResolverBundleTrust(pinnedKeys.toMap())
    private val verifiedBaseline = baseline?.let { (manifest, code) -> checkedBundle(manifest, code) }
    private val stateFile = File(directory, "state")
    private val stateLock = Any()
    private val refreshLock = Any()
    private var nextCheck = Long.MIN_VALUE
    private var refreshFailures = 0
    private var inFlight = false

    init {
        require(manifestUrl.isHttps && manifestUrl.port == 443 && manifestUrl.username.isEmpty() &&
            manifestUrl.password.isEmpty() && manifestUrl.query == null && manifestUrl.fragment == null &&
            manifestUrl.encodedPath == "/resolvers/v2/manifest.json")
        require(directory.isDirectory || directory.mkdirs())
    }

    /** Call asynchronously when service playback needs a resolver; this never starts a poll timer. */
    fun refresh(): Boolean {
        synchronized(refreshLock) {
            val now = clockMs()
            if (inFlight || now < nextCheck) return false
            inFlight = true
        }
        val result = runCatching {
            val bytes = download(manifestUrl, RESOLVER_MANIFEST_LIMIT, setOf("application/json"))
            val manifest = trust.verifyManifest(bytes)
            synchronized(stateLock) {
                if (manifest.version <= maxOf(readState().high, verifiedBaseline?.version ?: 0)) return@runCatching false
            }
            val url = manifestUrl.newBuilder().encodedPath(manifest.artifactPath).build()
            val code = download(url, manifest.byteLength, setOf("application/javascript", "text/javascript"))
            trust.verifyCode(manifest, code)
            synchronized(stateLock) {
                val state = readState()
                if (manifest.version <= state.high) return@synchronized false
                atomicWrite(codeFile(manifest.version), code)
                atomicWrite(manifestFile(manifest.version), bytes)
                saveState(state.copy(high = manifest.version, candidate = manifest.version, faults = 0))
                cleanArtifacts(manifest.version, state.good)
                true
            }
        }
        synchronized(refreshLock) {
            refreshFailures = if (result.isSuccess) 0 else (refreshFailures + 1).coerceAtMost(5)
            nextCheck = clockMs() + (CHECK_MS shl refreshFailures)
            inFlight = false
        }
        return result.getOrDefault(false)
    }

    /** Candidate first; callers may retry with includeCandidate=false without changing accepted high-water. */
    fun load(includeCandidate: Boolean = true): Bundle? = synchronized(stateLock) {
        val state = runCatching { readState() }.getOrNull()
        (if (includeCandidate) state?.candidate?.let(::readBundle) else null)
            ?: state?.good?.let(::readBundle)
            ?: verifiedBaseline
    }

    /** Call only after a real media open or equivalent smoke check, not on JS URL extraction alone. */
    fun promote(version: Long): Boolean = synchronized(stateLock) {
        runCatching {
            val state = readState()
            if (version == 0L || version != state.candidate || readBundle(version) == null) return@runCatching false
            saveState(state.copy(good = version, candidate = 0, faults = 0))
            cleanArtifacts(version, 0)
            true
        }.getOrDefault(false)
    }

    /**
     * Count genuine candidate resolver faults (e.g., JS error, malformed output, or isolate crash),
     * never transient network/offline errors, timeouts, or executor saturation.
     * Never quarantines when no fallback bundle exists (`good == 0` and no baseline) unless
     * [fallbackSucceeded] confirms an alternate resolver succeeded while the candidate failed.
     */
    fun recordFailure(version: Long, fallbackSucceeded: Boolean = false): Boolean = synchronized(stateLock) {
        runCatching {
            val state = readState()
            if (version == 0L || version != state.candidate) return@runCatching false
            val hasFallback = state.good > 0L || (verifiedBaseline != null && verifiedBaseline.version != version)
            if (!hasFallback && !fallbackSucceeded) return@runCatching false
            val quarantine = state.faults + 1 >= 2
            saveState(if (quarantine) state.copy(candidate = 0, faults = 0) else state.copy(faults = state.faults + 1))
            if (quarantine) cleanArtifacts(state.good, 0)
            quarantine
        }.getOrDefault(false)
    }

    private fun readBundle(version: Long): Bundle? = if (version <= 0) null else runCatching {
        checkedBundle(manifestFile(version).inputStream().use { it.readBounded(RESOLVER_MANIFEST_LIMIT) },
            codeFile(version).inputStream().use { it.readBounded(RESOLVER_MAX_BYTES) }).also { require(it.version == version) }
    }.getOrNull()

    private fun checkedBundle(manifest: ByteArray, code: ByteArray): Bundle {
        val verified = trust.verifyManifest(manifest)
        trust.verifyCode(verified, code)
        return Bundle(verified.version, code.decodeToString(throwOnInvalidSequence = true))
    }

    private fun readState(): State {
        if (!stateFile.exists()) return State()
        val fields = stateFile.inputStream().use { it.readBounded(128) }.decodeToString().split(',').map(String::toLong)
        require(fields.size == 4 && fields[0] > 0 && fields[1] in 0..fields[0] &&
            (fields[2] == 0L || fields[2] == fields[0] && fields[2] > fields[1]) && fields[3] in 0..1)
        return State(fields[0], fields[1], fields[2], fields[3].toInt())
    }

    private fun saveState(s: State) = atomicWrite(stateFile, "${s.high},${s.good},${s.candidate},${s.faults}".toByteArray())
    private fun manifestFile(version: Long) = File(directory, "$version.json")
    private fun codeFile(version: Long) = File(directory, "$version.js")
    private fun cleanArtifacts(first: Long, second: Long) {
        directory.listFiles()?.forEach { file ->
            val version = file.nameWithoutExtension.toLongOrNull()
            if (version != null && version != first && version != second && file.extension in setOf("js", "json")) file.delete()
        }
    }

    private companion object { const val CHECK_MS = 15 * 60_000L }
}

private fun writeResolverAtomically(file: File, bytes: ByteArray) {
    val temporary = File(file.parentFile, ".${file.name}.tmp")
    try {
        FileOutputStream(temporary).use { it.write(bytes); it.fd.sync() }
        Files.move(temporary.toPath(), file.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        FileChannel.open(file.parentFile!!.toPath(), READ).use { it.force(true) }
    } finally {
        temporary.delete()
    }
}

internal fun InputStream.readBounded(cap: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer)
        if (count == -1) return output.toByteArray()
        require(count <= cap - output.size()) { "Resolver response exceeds limit" }
        output.write(buffer, 0, count)
    }
}

private val resolverDownloadClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .proxy(java.net.Proxy.NO_PROXY).callTimeout(10, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()

private fun downloadResolverBytes(url: HttpUrl, cap: Int, mime: Set<String>): ByteArray {
    val request = Request.Builder().url(url).apply {
        if (url.encodedPath.endsWith("/manifest.json")) header("Cache-Control", "no-cache")
    }.build()
    return resolverDownloadClient.newCall(request).execute().use { response ->
        require(response.code == 200)
        val body = checkNotNull(response.body)
        val type = body.contentType()
        require(type != null && "${type.type}/${type.subtype}" in mime && body.contentLength() <= cap)
        body.byteStream().use { it.readBounded(cap) }
    }
}
