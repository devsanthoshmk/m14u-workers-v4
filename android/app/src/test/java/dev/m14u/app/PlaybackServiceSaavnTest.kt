package dev.m14u.app

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class PlaybackServiceSaavnTest {
    @Test
    fun parseSaavnAudioOriginAcceptsValidPublicHttpsPort443Origins() {
        assertEquals(
            "https://m14u-jiosaavn.onrender.com",
            PlaybackService.parseSaavnAudioOrigin("https://m14u-jiosaavn.onrender.com"),
        )
        assertEquals(
            "https://m14u-jiosaavn.onrender.com",
            PlaybackService.parseSaavnAudioOrigin("  https://m14u-jiosaavn.onrender.com:443  "),
        )
    }

    @Test
    fun parseSaavnAudioOriginRejectsUnsafeOrNonOriginUrls() {
        val invalidOrigins = listOf(
            "",
            "   ",
            "http://m14u-jiosaavn.onrender.com",
            "https://m14u-jiosaavn.onrender.com:8443",
            "https://m14u-jiosaavn.onrender.com/api/audio",
            "https://m14u-jiosaavn.onrender.com?foo=bar",
            "https://m14u-jiosaavn.onrender.com#frag",
            "https://user:pass@m14u-jiosaavn.onrender.com",
            "https://localhost",
            "https://localhost.",
            "https://127.0.0.1",
            "https://10.0.0.1",
            "https://172.16.0.1",
            "https://192.168.1.1",
            "https://[::1]",
            "https://m14u-jiosaavn.onrender.com.",
        )
        for (origin in invalidOrigins) {
            assertNull("Expected null for $origin", PlaybackService.parseSaavnAudioOrigin(origin))
        }
    }

    @Test
    fun buildJioSaavnStreamUrlConstructsSafeEndpointAndRejectsInvalidInputs() {
        assertEquals(
            "https://m14u-jiosaavn.onrender.com/api/audio/abc_123-XYZ",
            PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", "jiosaavn:abc_123-XYZ"),
        )
        assertEquals(
            "https://m14u-jiosaavn.onrender.com/api/audio/abc_123-XYZ",
            PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", "abc_123-XYZ"),
        )

        assertNull(PlaybackService.buildJioSaavnStreamUrl("http://m14u-jiosaavn.onrender.com", "jiosaavn:abc_123"))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://127.0.0.1", "jiosaavn:abc_123"))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com/path", "jiosaavn:abc_123"))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", ""))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", "jiosaavn:"))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", "jiosaavn:../etc/passwd"))
        assertNull(PlaybackService.buildJioSaavnStreamUrl("https://m14u-jiosaavn.onrender.com", "a/b"))
    }

    @Test
    fun loadErrorHandlingPolicyAllowsOneTransientRetryForUnprimedSaavnAndStopsOnTerminalOrSecondFailure() {
        val registry = PlaybackSourceRegistry(maxRetriesPerLoad = 1)
        registry.replaceQueue(
            generation = 1L,
            items = listOf(QueueEntryDescriptor("q1", ResolverKey("jiosaavn", "jiosaavn:abc_123"))),
        )
        val policy = PlaybackService.createLoadErrorHandlingPolicy(registry)
        assertEquals(1, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA))

        // Unprimed jiosaavn: 1st transient IOException consumes the 1 retry and allows retrying;
        // 2nd transient IOException sees budget exhausted and returns false (C.TIME_UNSET).
        assertTrue(registry.hasRetryRemaining("q1", 1L))
        assertTrue(
            PlaybackService.shouldRetryLoadError(
                error = IOException("timeout"),
                scheme = PlaybackSourceRegistry.RESOLVE_SCHEME,
                queueId = "q1",
                registry = registry,
            ),
        )
        assertFalse(registry.hasRetryRemaining("q1", 1L))
        assertFalse(
            PlaybackService.shouldRetryLoadError(
                error = IOException("timeout"),
                scheme = PlaybackSourceRegistry.RESOLVE_SCHEME,
                queueId = "q1",
                registry = registry,
            ),
        )

        // TerminalPlaybackIOException (e.g. invalid ID/origin or exhausted pre-resolved budget) gets 0 retries.
        registry.resetRetryBudget("q1", 1L)
        assertTrue(registry.hasRetryRemaining("q1", 1L))
        assertFalse(
            PlaybackService.shouldRetryLoadError(
                error = PlaybackService.TerminalPlaybackIOException("invalid track id"),
                scheme = PlaybackSourceRegistry.RESOLVE_SCHEME,
                queueId = "q1",
                registry = registry,
            ),
        )
        // Terminal error does not consume the retry budget needlessly; pre-resolved fallback consuming it blocks further retries.
        assertTrue(registry.tryConsumeRetry("q1", 1L))
        assertFalse(registry.hasRetryRemaining("q1", 1L))
        assertFalse(
            PlaybackService.shouldRetryLoadError(
                error = IOException("timeout"),
                scheme = PlaybackSourceRegistry.RESOLVE_SCHEME,
                queueId = "q1",
                registry = registry,
            ),
        )
    }
}
