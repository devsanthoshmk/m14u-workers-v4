package dev.m14u.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSourceRegistryTest {
    private var nowMs = 1_000_000L

    private fun registry(
        maxEntries: Int = PlaybackSourceRegistry.DEFAULT_MAX_ENTRIES,
        maxBatchSize: Int = PlaybackSourceRegistry.DEFAULT_MAX_BATCH_SIZE,
        maxRetries: Int = 1,
    ) = PlaybackSourceRegistry(
        clockMs = { nowMs },
        maxEntries = maxEntries,
        maxBatchSize = maxBatchSize,
        maxRetriesPerLoad = maxRetries,
    )

    @Test
    fun acceptsValidSourcesIncludingDuplicateTrackIdsAcrossDistinctQueueIds() {
        val reg = registry()
        val ytKey = ResolverKey("youtube", "pIWaVJPl0-c")
        val saavnKey = ResolverKey("jiosaavn", "saavn-track-99")
        reg.replaceQueue(
            generation = 1L,
            items = listOf(
                QueueEntryDescriptor(queueId = "q1", resolverKey = ytKey),
                QueueEntryDescriptor(queueId = "q2", resolverKey = ytKey),
                QueueEntryDescriptor(queueId = "q3", resolverKey = saavnKey),
            ),
        )

        val result = reg.setResolvedSources(
            generation = 1L,
            batch = listOf(
                ResolvedSourceInput(
                    queueId = "q1",
                    resolverKey = ytKey,
                    source = TrackSource(
                        url = "https://rr1.googlevideo.com/videoplayback?itag=140",
                        mimeType = "audio/mp4",
                        headers = mapOf("user-agent" to "M14U/2.0", "referer" to "https://www.youtube.com/"),
                        expiresAtMs = nowMs + 60_000L,
                    ),
                ),
                ResolvedSourceInput(
                    queueId = "q2",
                    resolverKey = ytKey,
                    source = TrackSource(
                        url = "https://rr2.googlevideo.com/videoplayback?itag=251",
                        expiresAtMs = nowMs + 60_000L,
                    ),
                ),
                ResolvedSourceInput(
                    queueId = "q3",
                    resolverKey = saavnKey,
                    source = TrackSource(
                        url = "https://aac.saavncdn.com/123/audio.mp4",
                        mimeType = "audio/mp4",
                        expiresAtMs = nowMs + 60_000L,
                    ),
                ),
            ),
        )

        assertEquals(SetSourcesResult(updated = 3, rejected = 0), result)
        val q1 = reg.lookupTarget("q1", expectedGeneration = 1L, expectedResolverKey = ytKey)!!
        val q1Source = q1.source!!
        assertEquals("https://rr1.googlevideo.com/videoplayback?itag=140", q1Source.url)
        assertEquals(mapOf("User-Agent" to "M14U/2.0", "Referer" to "https://www.youtube.com/"), q1Source.headers)
        assertEquals("https://rr2.googlevideo.com/videoplayback?itag=251", reg.lookupTarget("q2")!!.source!!.url)
        assertEquals("https://aac.saavncdn.com/123/audio.mp4", reg.lookupTarget("q3")!!.source!!.url)
    }

    @Test
    fun rejectsGenerationMismatchAndMissingGeneration() {
        val reg = registry()
        val key = ResolverKey("youtube", "dQw4w9WgXcQ")
        reg.replaceQueue(generation = 5L, items = listOf(QueueEntryDescriptor("q1", key)))

        val stale = reg.setResolvedSources(
            generation = 4L,
            batch = listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/a", expiresAtMs = nowMs + 10_000L))),
        )
        assertEquals(SetSourcesResult(updated = 0, rejected = 1), stale)
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNull(reg.lookupTarget("q1", expectedGeneration = 4L))

        val negative = reg.setResolvedSources(
            generation = -1L,
            batch = listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/a", expiresAtMs = nowMs + 10_000L))),
        )
        assertEquals(SetSourcesResult(updated = 0, rejected = 1), negative)

        reg.clear()
        val afterClear = reg.setResolvedSources(
            generation = 5L,
            batch = listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/a", expiresAtMs = nowMs + 10_000L))),
        )
        assertEquals(SetSourcesResult(updated = 0, rejected = 1), afterClear)
    }

    @Test
    fun rejectsResolverKeyMismatch() {
        val reg = registry()
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(
            generation = 2L,
            items = listOf(
                QueueEntryDescriptor("q1", key),
                QueueEntryDescriptor("q2", null),
            ),
        )

        val result = reg.setResolvedSources(
            generation = 2L,
            batch = listOf(
                ResolvedSourceInput("q1", ResolverKey("youtube", "dQw4w9WgXcQ"), TrackSource("https://rr1.googlevideo.com/a")),
                ResolvedSourceInput("q1", ResolverKey("jiosaavn", "pIWaVJPl0-c"), TrackSource("https://rr1.googlevideo.com/a")),
                ResolvedSourceInput("q1", null, TrackSource("https://rr1.googlevideo.com/a")),
                ResolvedSourceInput("q2", key, TrackSource("https://rr1.googlevideo.com/a")),
            ),
        )
        assertEquals(SetSourcesResult(updated = 0, rejected = 4), result)
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNull(reg.lookupTarget("q2")!!.source)
        assertNull(reg.lookupTarget("q1", expectedResolverKey = ResolverKey("youtube", "dQw4w9WgXcQ")))

        // Unkeyed row accepts null resolverKey.
        assertEquals(
            SetSourcesResult(updated = 1, rejected = 0),
            reg.setResolvedSources(2L, listOf(ResolvedSourceInput("q2", null, TrackSource("https://rr1.googlevideo.com/unkeyed")))),
        )
        assertEquals("https://rr1.googlevideo.com/unkeyed", reg.lookupTarget("q2")!!.source!!.url)
    }

    @Test
    fun prunesExpiredSourcesAndAppliesDefaultTtl() {
        val reg = registry()
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(
            generation = 1L,
            items = listOf(
                QueueEntryDescriptor("q1", key),
                QueueEntryDescriptor("q2", key),
            ),
        )

        val result = reg.setResolvedSources(
            generation = 1L,
            batch = listOf(
                ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/expired", expiresAtMs = nowMs)),
                ResolvedSourceInput("q2", key, TrackSource("https://rr1.googlevideo.com/short", expiresAtMs = nowMs + 5_000L)),
            ),
        )
        assertEquals(SetSourcesResult(updated = 1, rejected = 1), result)
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNotNull(reg.lookupTarget("q2")!!.source)

        nowMs += 5_000L
        assertNull(reg.lookupTarget("q2")!!.source)
        assertEquals(0, reg.cachedSourceCount())

        // Without explicit expiresAtMs, conservative default TTL (5 min) applies.
        assertEquals(
            SetSourcesResult(updated = 1, rejected = 0),
            reg.setResolvedSources(1L, listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/default")))),
        )
        assertNotNull(reg.lookupTarget("q1")!!.source)
        nowMs += PlaybackSourceRegistry.DEFAULT_TTL_MS
        assertNull(reg.lookupTarget("q1")!!.source)
    }

    @Test
    fun prunesRemovedEntriesOnQueueReplaceUpdateAndClear() {
        val reg = registry()
        val keyA = ResolverKey("youtube", "pIWaVJPl0-c")
        val keyB = ResolverKey("youtube", "dQw4w9WgXcQ")
        val keyC = ResolverKey("audius", "audius-track-1")

        reg.replaceQueue(
            generation = 1L,
            items = listOf(
                QueueEntryDescriptor("q1", keyA, TrackSource("https://rr1.googlevideo.com/a", expiresAtMs = nowMs + 60_000L)),
                QueueEntryDescriptor("q2", keyB, TrackSource("https://rr1.googlevideo.com/b", expiresAtMs = nowMs + 60_000L)),
            ),
        )
        assertEquals(2, reg.size())

        // Update queue: retain q2, remove q1, add q3, bump generation to 2.
        reg.updateQueue(
            generation = 2L,
            items = listOf(
                QueueEntryDescriptor("q2", keyB),
                QueueEntryDescriptor("q3", keyC),
            ),
        )
        assertNull(reg.lookupTarget("q1"))
        assertEquals("https://rr1.googlevideo.com/b", reg.lookupTarget("q2")!!.source!!.url)
        assertEquals(2L, reg.currentGeneration())

        // Old generation 1 cannot write anymore; generation 2 works for q3 and rejects removed q1.
        assertEquals(
            SetSourcesResult(0, 1),
            reg.setResolvedSources(1L, listOf(ResolvedSourceInput("q3", keyC, TrackSource("https://node.audius.co/stream")))),
        )
        assertEquals(
            SetSourcesResult(1, 1),
            reg.setResolvedSources(
                2L,
                listOf(
                    ResolvedSourceInput("q1", keyA, TrackSource("https://rr1.googlevideo.com/a")),
                    ResolvedSourceInput("q3", keyC, TrackSource("https://node.audius.co/stream")),
                ),
            ),
        )

        // Replace queue wipes previous entries.
        reg.replaceQueue(3L, listOf(QueueEntryDescriptor("q4", keyA)))
        assertNull(reg.lookupTarget("q2"))
        assertNull(reg.lookupTarget("q3"))
        assertEquals(1, reg.size())

        reg.clear()
        assertEquals(0, reg.size())
        assertNull(reg.currentGeneration())
    }

    @Test
    fun handlesDuplicateQueueIdsInQueueAndBatches() {
        val reg = registry()
        val key = ResolverKey("youtube", "pIWaVJPl0-c")

        assertThrows(IllegalArgumentException::class.java) {
            reg.replaceQueue(
                generation = 1L,
                items = listOf(QueueEntryDescriptor("dup", key), QueueEntryDescriptor("dup", key)),
            )
        }

        reg.replaceQueue(generation = 1L, items = listOf(QueueEntryDescriptor("q1", key)))
        assertThrows(IllegalArgumentException::class.java) {
            reg.updateQueue(
                generation = 2L,
                items = listOf(QueueEntryDescriptor("q1", key), QueueEntryDescriptor("q1", key)),
            )
        }

        // Duplicate queueId in a single setResolvedSources batch: first succeeds, duplicate is rejected.
        val res = reg.setResolvedSources(
            generation = 1L,
            batch = listOf(
                ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/first")),
                ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/second")),
            ),
        )
        assertEquals(SetSourcesResult(updated = 1, rejected = 1), res)
        assertEquals("https://rr1.googlevideo.com/first", reg.lookupTarget("q1")!!.source!!.url)
    }

    @Test
    fun rejectsNonHttpsAndUnsafeUrls() {
        val reg = registry()
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(1L, listOf(QueueEntryDescriptor("q1", key)))

        val badUrls = listOf(
            "http://rr1.googlevideo.com/videoplayback",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "m14u-resolve://track/q1",
            "https://user:pass@rr1.googlevideo.com/videoplayback",
            "https://localhost/audio.mp4",
            "https://localhost./audio.mp4",
            "https://sub.localhost./audio.mp4",
            "https://127.0.0.1/audio.mp4",
            "https://127.0.0.1./audio.mp4",
            "https://2130706433/audio.mp4",
            "https://0x7f000001/audio.mp4",
            "https://127.1/audio.mp4",
            "https://0177.0.0.1/audio.mp4",
            "https://0x7f.0.0.1/audio.mp4",
            "https://127.00.0.1/audio.mp4",
            "https://10.0.0.5/audio.mp4",
            "https://172.16.0.1/audio.mp4",
            "https://192.168.1.10/audio.mp4",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/audio.mp4",
            "https://rr1.googlevideo.com./videoplayback",
            "https://rr1.googlevideo.com:8443/videoplayback",
            "https://rr1.googlevideo.com/videoplayback#frag",
            "https://rr1.googlevideo.com/video\\playback",
        )
        val batch = badUrls.map { ResolvedSourceInput("q1", key, TrackSource(it)) }
        val result = reg.setResolvedSources(1L, batch)
        assertEquals(0, result.updated)
        assertEquals(badUrls.size, result.rejected)
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNotNull(PlaybackSourceRegistry.validateHttpsUrl("https://8.8.8.8/audio.mp4"))
    }

    @Test
    fun rejectsUnsafeHeadersAndAcceptsSafeAllowlistedHeaders() {
        val reg = registry()
        val key = ResolverKey("jiosaavn", "track-1")
        reg.replaceQueue(1L, listOf(QueueEntryDescriptor("q1", key)))

        val unsafeHeaders = listOf(
            mapOf("Cookie" to "session=secret"),
            mapOf("Set-Cookie" to "a=b"),
            mapOf("Authorization" to "Bearer token"),
            mapOf("Proxy-Authorization" to "Basic abc"),
            mapOf("Host" to "evil.example"),
            mapOf("Range" to "bytes=0-1023"),
            mapOf("range" to "bytes=0-10"),
            mapOf("User-Agent" to "M14U\r\nX-Injected: true"),
            mapOf("Accept" to "*/*", "accept" to "audio/*"),
        )
        for (headers in unsafeHeaders) {
            val res = reg.setResolvedSources(
                1L,
                listOf(ResolvedSourceInput("q1", key, TrackSource("https://aac.saavncdn.com/a.mp4", headers = headers))),
            )
            assertEquals(SetSourcesResult(0, 1), res)
        }

        val safeResult = reg.setResolvedSources(
            1L,
            listOf(
                ResolvedSourceInput(
                    "q1",
                    key,
                    TrackSource(
                        url = "https://aac.saavncdn.com/a.mp4",
                        headers = mapOf(
                            "User-Agent" to "M14U-Android/2.0",
                            "Referer" to "https://www.jiosaavn.com/",
                            "Accept" to "audio/*",
                            "Accept-Language" to "en-US",
                        ),
                    ),
                ),
            ),
        )
        assertEquals(SetSourcesResult(1, 0), safeResult)
        assertEquals(4, reg.lookupTarget("q1")!!.source!!.headers.size)
    }

    @Test
    fun enforcesBoundedEntryCountAndBatchSize() {
        val reg = registry(maxEntries = 2, maxBatchSize = 3)
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(
            1L,
            listOf(
                QueueEntryDescriptor("q1", key),
                QueueEntryDescriptor("q2", key),
                QueueEntryDescriptor("q3", key),
                QueueEntryDescriptor("q4", key),
            ),
        )

        val result = reg.setResolvedSources(
            1L,
            listOf(
                ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/1")),
                ResolvedSourceInput("q2", key, TrackSource("https://rr1.googlevideo.com/2")),
                ResolvedSourceInput("q3", key, TrackSource("https://rr1.googlevideo.com/3")),
                ResolvedSourceInput("q4", key, TrackSource("https://rr1.googlevideo.com/4")),
            ),
        )
        // maxBatchSize = 3 rejects the 4th entry; maxEntries = 2 evicts oldest cached source (q1).
        assertEquals(SetSourcesResult(updated = 3, rejected = 1), result)
        assertEquals(2, reg.cachedSourceCount())
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNotNull(reg.lookupTarget("q2")!!.source)
        assertNotNull(reg.lookupTarget("q3")!!.source)
    }

    @Test
    fun protectsActiveAndUpcomingQueueIdsFromCapacityEviction() {
        val reg = registry(maxEntries = 3, maxBatchSize = 10)
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(
            generation = 1L,
            items = listOf(
                QueueEntryDescriptor("q1", key, TrackSource("https://rr1.googlevideo.com/1")),
                QueueEntryDescriptor("q2", key, TrackSource("https://rr1.googlevideo.com/2")),
                QueueEntryDescriptor("q3", key, TrackSource("https://rr1.googlevideo.com/3")),
                QueueEntryDescriptor("q4", key),
            ),
            activeQueueId = "q2",
        )
        // Inserting q4 while q2 is active (and q3 is upcoming) should evict q1 first, keeping q2, q3, q4.
        assertEquals(
            SetSourcesResult(1, 0),
            reg.setResolvedSources(1L, listOf(ResolvedSourceInput("q4", key, TrackSource("https://rr1.googlevideo.com/4")))),
        )
        assertNull(reg.lookupTarget("q1")!!.source)
        assertNotNull(reg.lookupTarget("q2")!!.source)
        assertNotNull(reg.lookupTarget("q3")!!.source)
        assertNotNull(reg.lookupTarget("q4")!!.source)
    }

    @Test
    fun enforcesBoundedRetryBudgetPerLoadAndResetsOnSuccessOrNewSource() {
        val reg = registry(maxRetries = 1)
        val key = ResolverKey("youtube", "pIWaVJPl0-c")
        reg.replaceQueue(
            1L,
            listOf(
                QueueEntryDescriptor("q1", key, TrackSource("https://rr1.googlevideo.com/old")),
            ),
        )

        assertTrue(reg.hasRetryRemaining("q1", 1L))
        assertTrue(reg.invalidateSource("q1", 1L, "https://rr1.googlevideo.com/old"))
        assertNull(reg.lookupTarget("q1")!!.source)

        assertTrue(reg.tryConsumeRetry("q1", 1L))
        assertFalse(reg.hasRetryRemaining("q1", 1L))
        assertFalse(reg.tryConsumeRetry("q1", 1L))

        // Re-supplying the exact same failed URL does not reset retry budget.
        reg.setResolvedSources(1L, listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/old"))))
        assertFalse(reg.tryConsumeRetry("q1", 1L))

        // Supplying a fresh URL or resetting after playback success restores the budget.
        reg.setResolvedSources(1L, listOf(ResolvedSourceInput("q1", key, TrackSource("https://rr1.googlevideo.com/fresh"))))
        assertTrue(reg.hasRetryRemaining("q1", 1L))

        assertTrue(reg.tryConsumeRetry("q1", 1L))
        assertFalse(reg.tryConsumeRetry("q1", 1L))
        reg.resetRetryBudget("q1", 1L)
        assertTrue(reg.hasRetryRemaining("q1", 1L))
    }

    @Test
    fun parsesPinnedKeysAndManifestUrlConfig() {
        assertTrue(PlaybackService.parsePinnedKeys("").isEmpty())
        assertEquals(
            mapOf("k1" to "SPKI1==", "k2" to "SPKI2=="),
            PlaybackService.parsePinnedKeys("""{"k1":"SPKI1==","k2":"SPKI2==","bad key":""}"""),
        )
        assertEquals(
            mapOf("k1" to "SPKI1==", "k2" to "SPKI2=="),
            PlaybackService.parsePinnedKeys("k1=SPKI1==, k2=SPKI2=="),
        )
        assertNotNull(PlaybackService.parseManifestUrl("https://m14u.pages.dev/resolvers/v2/manifest.json"))
        assertNull(PlaybackService.parseManifestUrl("http://m14u.pages.dev/resolvers/v2/manifest.json"))
        assertNull(PlaybackService.parseManifestUrl("https://m14u.pages.dev/other.json"))
    }

    @Test
    fun validatesJioSaavnResolverKeysAndRawIdExtraction() {
        assertEquals("saavn-track_99", PlaybackSourceRegistry.extractSaavnRawId("jiosaavn:saavn-track_99"))
        assertEquals("saavn-track_99", PlaybackSourceRegistry.extractSaavnRawId("saavn-track_99"))
        assertTrue(PlaybackSourceRegistry.isValidResolverKey(ResolverKey("jiosaavn", "jiosaavn:saavn-track_99")))
        assertTrue(PlaybackSourceRegistry.isValidResolverKey(ResolverKey("jiosaavn", "saavn-track_99")))

        val maxId = "a".repeat(64)
        assertEquals(maxId, PlaybackSourceRegistry.extractSaavnRawId("jiosaavn:$maxId"))
        assertTrue(PlaybackSourceRegistry.isValidResolverKey(ResolverKey("jiosaavn", "jiosaavn:$maxId")))

        val malformed = listOf(
            "",
            "jiosaavn:",
            "jiosaavn:../secret",
            "jiosaavn:a/b",
            "jiosaavn:a?b=1",
            "jiosaavn:a#b",
            "jiosaavn:a b",
            "jiosaavn:jiosaavn:abc",
            "../secret",
            "a".repeat(65),
            "jiosaavn:" + "a".repeat(65),
        )
        for (badId in malformed) {
            assertNull("Expected null for $badId", PlaybackSourceRegistry.extractSaavnRawId(badId))
            assertFalse("Expected invalid key for $badId", PlaybackSourceRegistry.isValidResolverKey(ResolverKey("jiosaavn", badId)))
        }

        val reg = registry()
        reg.replaceQueue(
            generation = 1L,
            items = listOf(
                QueueEntryDescriptor("q1", ResolverKey("jiosaavn", "jiosaavn:abc_123")),
                QueueEntryDescriptor("q2", ResolverKey("jiosaavn", "xyz-456")),
            ),
        )
        assertEquals(2, reg.size())
        assertThrows(IllegalArgumentException::class.java) {
            reg.replaceQueue(1L, listOf(QueueEntryDescriptor("q3", ResolverKey("jiosaavn", "jiosaavn:../bad"))))
        }
    }
}
