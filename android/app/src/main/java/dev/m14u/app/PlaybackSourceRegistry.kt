package dev.m14u.app

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.InetAddress
import java.util.Locale

internal data class ResolverKey(
    val provider: String,
    val trackId: String,
)

internal data class TrackSource(
    val url: String,
    val mimeType: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val expiresAtMs: Long? = null,
)

internal data class QueueEntryDescriptor(
    val queueId: String,
    val resolverKey: ResolverKey? = null,
    val source: TrackSource? = null,
    val legacyProxy: String? = null,
)

internal data class ResolvedSourceInput(
    val queueId: String,
    val resolverKey: ResolverKey? = null,
    val source: TrackSource,
)

internal data class SetSourcesResult(
    val updated: Int,
    val rejected: Int,
)

internal data class PlaybackResolutionTarget(
    val queueId: String,
    val generation: Long?,
    val resolverKey: ResolverKey?,
    val source: TrackSource?,
    val legacyProxy: String?,
)

/**
 * Thread-safe, session-scoped source registry shared between NativePlaybackPlugin and PlaybackService.
 * Uses queueId + generation + resolverKey identity and enforces URL, header, TTL, size, and retry bounds.
 */
internal class PlaybackSourceRegistry(
    private val clockMs: () -> Long = System::currentTimeMillis,
    private val maxEntries: Int = DEFAULT_MAX_ENTRIES,
    private val maxQueueItems: Int = DEFAULT_MAX_QUEUE_ITEMS,
    private val maxBatchSize: Int = DEFAULT_MAX_BATCH_SIZE,
    private val defaultTtlMs: Long = DEFAULT_TTL_MS,
    private val maxRetriesPerLoad: Int = DEFAULT_MAX_RETRIES_PER_LOAD,
) {
    private class EntryState(
        var resolverKey: ResolverKey?,
        var legacyProxy: String?,
        var source: TrackSource? = null,
        var sourceSequence: Long = 0L,
        var retryCount: Int = 0,
        var lastFailedUrl: String? = null,
    )

    private val lock = Any()
    private val entries = LinkedHashMap<String, EntryState>()
    private var activeGeneration: Long? = null
    private var activeQueueId: String? = null
    private var sequence = 0L

    init {
        require(maxEntries >= 1 && maxQueueItems >= 1 && maxBatchSize >= 1 && defaultTtlMs > 0L && maxRetriesPerLoad >= 0)
    }

    fun currentGeneration(): Long? = synchronized(lock) { activeGeneration }

    fun setActiveQueueId(queueId: String?) {
        synchronized(lock) {
            activeQueueId = queueId?.takeIf { it in entries }
        }
    }

    fun size(): Int = synchronized(lock) { entries.size }

    fun cachedSourceCount(): Int = synchronized(lock) {
        pruneExpiredLocked(clockMs())
        entries.values.count { it.source != null }
    }

    fun replaceQueue(generation: Long?, items: List<QueueEntryDescriptor>, activeQueueId: String? = null) {
        require(items.size <= maxQueueItems) { "Queue exceeds maximum size ($maxQueueItems)" }
        if (generation != null) require(generation >= 0L) { "Invalid generation" }
        val seen = HashSet<String>(items.size)
        val validated = items.map { item ->
            require(isValidQueueId(item.queueId)) { "Invalid queueId" }
            require(seen.add(item.queueId)) { "Duplicate queueId: ${item.queueId}" }
            item.resolverKey?.let { require(isValidResolverKey(it)) { "Invalid resolverKey" } }
            val validatedSource = item.source?.let {
                validateTrackSource(it, clockMs(), requireUnexpired = false)
                    ?: throw IllegalArgumentException("Invalid source for ${item.queueId}")
            }
            item to validatedSource
        }
        synchronized(lock) {
            val now = clockMs()
            entries.clear()
            activeGeneration = generation
            this.activeQueueId = activeQueueId?.takeIf { it in seen }
            for ((item, source) in validated) {
                val validUnexpired = source?.takeIf { (it.expiresAtMs ?: Long.MAX_VALUE) > now }
                entries[item.queueId] = EntryState(
                    resolverKey = item.resolverKey,
                    legacyProxy = item.legacyProxy?.takeIf { it.isNotBlank() },
                    source = validUnexpired,
                    sourceSequence = if (validUnexpired != null) ++sequence else 0L,
                )
            }
            enforceSourceCapacityLocked(protectedQueueId = null)
        }
    }

    fun updateQueue(generation: Long?, items: List<QueueEntryDescriptor>, activeQueueId: String? = null) {
        require(items.size <= maxQueueItems) { "Queue exceeds maximum size ($maxQueueItems)" }
        if (generation != null) require(generation >= 0L) { "Invalid generation" }
        val seen = HashSet<String>(items.size)
        val validated = items.map { item ->
            require(isValidQueueId(item.queueId)) { "Invalid queueId" }
            require(seen.add(item.queueId)) { "Duplicate queueId: ${item.queueId}" }
            item.resolverKey?.let { require(isValidResolverKey(it)) { "Invalid resolverKey" } }
            val validatedSource = item.source?.let {
                validateTrackSource(it, clockMs(), requireUnexpired = false)
                    ?: throw IllegalArgumentException("Invalid source for ${item.queueId}")
            }
            item to validatedSource
        }
        synchronized(lock) {
            val now = clockMs()
            pruneExpiredLocked(now)
            val updatedMap = LinkedHashMap<String, EntryState>(validated.size)
            for ((item, explicitSource) in validated) {
                val previous = entries[item.queueId]
                val sameKey = previous != null && previous.resolverKey == item.resolverKey
                val nextSource = when {
                    explicitSource != null -> explicitSource.takeIf { (it.expiresAtMs ?: Long.MAX_VALUE) > now }
                    sameKey -> previous?.source
                    else -> null
                }
                val retryCount = if (sameKey) previous!!.retryCount else 0
                val lastFailed = if (sameKey) previous!!.lastFailedUrl else null
                val seq = when {
                    explicitSource != null && nextSource != null -> ++sequence
                    nextSource != null && previous != null -> previous.sourceSequence
                    else -> 0L
                }
                updatedMap[item.queueId] = EntryState(
                    resolverKey = item.resolverKey,
                    legacyProxy = item.legacyProxy?.takeIf { it.isNotBlank() },
                    source = nextSource,
                    sourceSequence = seq,
                    retryCount = retryCount,
                    lastFailedUrl = lastFailed,
                )
            }
            entries.clear()
            entries.putAll(updatedMap)
            activeGeneration = generation
            val nextActive = activeQueueId ?: this.activeQueueId
            this.activeQueueId = nextActive?.takeIf { it in entries }
            enforceSourceCapacityLocked(protectedQueueId = null)
        }
    }

    fun setResolvedSources(generation: Long, batch: List<ResolvedSourceInput>): SetSourcesResult {
        synchronized(lock) {
            val now = clockMs()
            pruneExpiredLocked(now)
            val currentGen = activeGeneration
            if (generation < 0L || currentGen == null || generation != currentGen) {
                return SetSourcesResult(updated = 0, rejected = batch.size)
            }
            var updated = 0
            var rejected = 0
            val seenInBatch = HashSet<String>()
            for ((index, input) in batch.withIndex()) {
                if (index >= maxBatchSize || !isValidQueueId(input.queueId) || !seenInBatch.add(input.queueId)) {
                    rejected++
                    continue
                }
                val state = entries[input.queueId]
                if (state == null) {
                    rejected++
                    continue
                }
                if (state.resolverKey != null) {
                    if (input.resolverKey == null || !isValidResolverKey(input.resolverKey) || input.resolverKey != state.resolverKey) {
                        rejected++
                        continue
                    }
                } else if (input.resolverKey != null) {
                    rejected++
                    continue
                }
                val validated = validateTrackSource(input.source, now, requireUnexpired = true)
                if (validated == null) {
                    rejected++
                    continue
                }
                if (validated.url != state.lastFailedUrl) {
                    state.retryCount = 0
                    state.lastFailedUrl = null
                }
                state.source = validated
                state.sourceSequence = ++sequence
                updated++
                enforceSourceCapacityLocked(protectedQueueId = input.queueId)
            }
            return SetSourcesResult(updated = updated, rejected = rejected)
        }
    }

    fun lookupTarget(
        queueId: String,
        expectedGeneration: Long? = null,
        expectedResolverKey: ResolverKey? = null,
    ): PlaybackResolutionTarget? = synchronized(lock) {
        val now = clockMs()
        pruneExpiredLocked(now)
        if (expectedGeneration != null && expectedGeneration != activeGeneration) return null
        val state = entries[queueId] ?: return null
        if (expectedResolverKey != null && state.resolverKey != expectedResolverKey) return null
        PlaybackResolutionTarget(
            queueId = queueId,
            generation = activeGeneration,
            resolverKey = state.resolverKey,
            source = state.source,
            legacyProxy = state.legacyProxy,
        )
    }

    fun cacheNativeResolvedSource(
        queueId: String,
        generation: Long?,
        resolverKey: ResolverKey?,
        url: String,
        mimeType: String? = null,
        ttlMs: Long = defaultTtlMs,
    ): Boolean = synchronized(lock) {
        val now = clockMs()
        pruneExpiredLocked(now)
        if (generation != activeGeneration) return false
        val state = entries[queueId] ?: return false
        if (resolverKey != null && state.resolverKey != null && state.resolverKey != resolverKey) return false
        val validated = validateTrackSource(
            TrackSource(
                url = url,
                mimeType = mimeType,
                headers = emptyMap(),
                expiresAtMs = now + ttlMs.coerceIn(1_000L, defaultTtlMs),
            ),
            now = now,
            requireUnexpired = true,
        ) ?: return false
        state.source = validated
        state.sourceSequence = ++sequence
        enforceSourceCapacityLocked(protectedQueueId = queueId)
        true
    }

    fun invalidateSource(queueId: String, generation: Long? = null, failedUrl: String? = null): Boolean = synchronized(lock) {
        if (generation != null && generation != activeGeneration) return false
        val state = entries[queueId] ?: return false
        val existing = state.source ?: return false
        if (failedUrl != null && existing.url != failedUrl) return false
        state.source = null
        state.sourceSequence = 0L
        state.lastFailedUrl = existing.url
        true
    }

    fun tryConsumeRetry(queueId: String, generation: Long? = null): Boolean = synchronized(lock) {
        if (generation != null && generation != activeGeneration) return false
        val state = entries[queueId] ?: return false
        if (state.retryCount >= maxRetriesPerLoad) return false
        state.retryCount++
        true
    }

    fun hasRetryRemaining(queueId: String, generation: Long? = null): Boolean = synchronized(lock) {
        if (generation != null && generation != activeGeneration) return false
        val state = entries[queueId] ?: return false
        state.retryCount < maxRetriesPerLoad
    }

    fun resetRetryBudget(queueId: String, generation: Long? = null) {
        synchronized(lock) {
            if (generation != null && generation != activeGeneration) return
            entries[queueId]?.let {
                it.retryCount = 0
                it.lastFailedUrl = null
            }
        }
    }

    fun clear() {
        synchronized(lock) {
            entries.clear()
            activeGeneration = null
            activeQueueId = null
        }
    }

    private fun pruneExpiredLocked(now: Long) {
        for (state in entries.values) {
            val expiresAt = state.source?.expiresAtMs ?: continue
            if (expiresAt <= now) {
                state.source = null
                state.sourceSequence = 0L
            }
        }
    }

    private fun enforceSourceCapacityLocked(protectedQueueId: String?) {
        var count = entries.values.count { it.source != null }
        if (count <= maxEntries) return

        val hardProtected = HashSet<String>(2)
        activeQueueId?.let(hardProtected::add)
        protectedQueueId?.let(hardProtected::add)

        val upcomingProtected = HashSet<String>(2)
        val activeId = activeQueueId
        if (activeId != null && entries.size > 1) {
            val keys = entries.keys.toList()
            val idx = keys.indexOf(activeId)
            if (idx >= 0) {
                if (idx + 1 < keys.size) upcomingProtected.add(keys[idx + 1])
                if (idx + 2 < keys.size) upcomingProtected.add(keys[idx + 2])
            }
        }

        while (count > maxEntries) {
            val victim = entries.entries
                .filter { it.key !in hardProtected && it.key !in upcomingProtected && it.value.source != null }
                .minByOrNull { it.value.sourceSequence }
                ?: entries.entries
                    .filter { it.key !in hardProtected && it.value.source != null }
                    .minByOrNull { it.value.sourceSequence }
                ?: entries.entries
                    .filter { it.key != protectedQueueId && it.value.source != null }
                    .minByOrNull { it.value.sourceSequence }
                ?: break
            victim.value.source = null
            victim.value.sourceSequence = 0L
            count--
        }
    }

    private fun validateTrackSource(
        source: TrackSource,
        now: Long,
        requireUnexpired: Boolean,
    ): TrackSource? {
        val cleanUrl = validateHttpsUrl(source.url) ?: return null
        val cleanMime = source.mimeType?.trim()?.takeIf { it.isNotEmpty() }
        if (cleanMime != null && (cleanMime.length > 256 || cleanMime.any { it.isISOControl() })) {
            return null
        }
        val cleanHeaders = sanitizeHeaders(source.headers) ?: return null
        val expiresAt = source.expiresAtMs
        if (expiresAt != null) {
            if (expiresAt <= 0L) return null
            if (requireUnexpired && expiresAt <= now) return null
        }
        return TrackSource(
            url = cleanUrl,
            mimeType = cleanMime,
            headers = cleanHeaders,
            expiresAtMs = expiresAt ?: (now + defaultTtlMs),
        )
    }

    companion object {
        const val RESOLVE_SCHEME = "m14u-resolve"
        const val RESOLVE_AUTHORITY = "track"
        const val LEGACY_TRACK_SCHEME = "m14u-track"
        const val DEFAULT_MAX_ENTRIES = 256
        const val DEFAULT_MAX_QUEUE_ITEMS = 1000
        const val DEFAULT_MAX_BATCH_SIZE = 128
        const val DEFAULT_TTL_MS = 5 * 60_000L
        const val DEFAULT_MAX_RETRIES_PER_LOAD = 1
        private const val MAX_URL_LENGTH = 8192
        private const val MAX_HEADERS = 8
        private const val MAX_HEADER_VALUE_LENGTH = 1024

        val YOUTUBE_ID_REGEX = Regex("[A-Za-z0-9_-]{11}")
        val SAAVN_ID_REGEX = Regex("[A-Za-z0-9_-]{1,64}")
        val PROVIDER_REGEX = Regex("[a-z0-9_-]{1,32}")
        private val NUMERIC_LABEL_REGEX = Regex("(0x[0-9a-f]+|\\d+)")

        private val ALLOWED_HEADERS = mapOf(
            "accept" to "Accept",
            "accept-encoding" to "Accept-Encoding",
            "accept-language" to "Accept-Language",
            "referer" to "Referer",
            "user-agent" to "User-Agent",
        )

        val shared = PlaybackSourceRegistry()

        fun isValidQueueId(queueId: String): Boolean =
            queueId.isNotEmpty() && queueId.length <= 128 && !queueId.any { it.isWhitespace() || it.isISOControl() }

        fun extractSaavnRawId(trackId: String): String? {
            if (trackId.isEmpty() || trackId.length > 128) return null
            val rawId = if (trackId.startsWith("jiosaavn:")) {
                trackId.removePrefix("jiosaavn:")
            } else {
                trackId
            }
            return rawId.takeIf { SAAVN_ID_REGEX.matches(it) }
        }

        fun isValidResolverKey(key: ResolverKey): Boolean {
            if (!PROVIDER_REGEX.matches(key.provider)) return false
            if (key.trackId.isEmpty() || key.trackId.length > 128 || key.trackId.any { it.isISOControl() }) return false
            if (key.provider == "youtube" && !YOUTUBE_ID_REGEX.matches(key.trackId)) return false
            if (key.provider == "jiosaavn" && extractSaavnRawId(key.trackId) == null) return false
            return true
        }

        fun validateHttpsUrl(rawUrl: String): String? {
            if (rawUrl.isBlank() || rawUrl.length > MAX_URL_LENGTH) return null
            if ('\\' in rawUrl || rawUrl.any { it.isWhitespace() || it.isISOControl() }) return null
            val authority = rawUrl.substringAfter("://", missingDelimiterValue = "").substringBefore('/')
            if ('@' in authority) return null
            val parsed = rawUrl.toHttpUrlOrNull() ?: return null
            if (!parsed.isHttps || parsed.port != 443 || parsed.username.isNotEmpty() ||
                parsed.password.isNotEmpty() || parsed.fragment != null) {
                return null
            }
            val rawHost = parsed.host.lowercase(Locale.ROOT)
            if (rawHost.isEmpty() || rawHost.endsWith(".")) return null
            val host = rawHost.trimEnd('.')
            if (host == "localhost" || host.endsWith(".localhost") ||
                host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".arpa")) {
                return null
            }
            if (':' in host) {
                val address = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return null
                if (!isPublicAddress(address)) return null
                return parsed.toString()
            }
            val labels = host.split('.')
            if (labels.size < 2 || labels.any { it.isEmpty() }) return null
            if (labels.all { NUMERIC_LABEL_REGEX.matches(it) }) {
                if (!isStrictDottedQuad(labels)) return null
                val address = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return null
                if (!isPublicAddress(address)) return null
                return parsed.toString()
            }
            if (NUMERIC_LABEL_REGEX.matches(labels.last())) return null
            return parsed.toString()
        }

        private fun isStrictDottedQuad(labels: List<String>): Boolean {
            if (labels.size != 4) return false
            return labels.all { label ->
                label == "0" || (!label.startsWith("0") && label.all(Char::isDigit) && (label.toIntOrNull() ?: -1) in 0..255)
            }
        }

        fun sanitizeHeaders(headers: Map<String, String>): Map<String, String>? {
            if (headers.isEmpty()) return emptyMap()
            if (headers.size > MAX_HEADERS) return null
            val clean = LinkedHashMap<String, String>(headers.size)
            for ((rawName, rawValue) in headers) {
                val canonical = ALLOWED_HEADERS[rawName.trim().lowercase(Locale.ROOT)] ?: return null
                if (canonical in clean) return null
                if (rawValue.length > MAX_HEADER_VALUE_LENGTH || rawValue.any { it !in ' '..'~' }) return null
                clean[canonical] = rawValue
            }
            return clean
        }

        private fun isPublicAddress(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress) {
                return false
            }
            val octets = address.address.map { it.toInt() and 255 }
            val (a, b, c) = octets
            if (octets.size == 4) {
                return a in 1..223 && a != 127 &&
                    !(a == 100 && b in 64..127 ||
                        a == 192 && (b == 0 && c in setOf(0, 2) || b == 88 && c == 99) ||
                        a == 198 && (b in 18..19 || b == 51 && c == 100) ||
                        a == 203 && b == 0 && c == 113)
            }
            return a in 0x20..0x3f && !(a == 0x20 && (b == 2 || b == 1 && (c < 2 || c == 0x0d && octets[3] == 0xb8)))
        }
    }
}
