package dev.m14u.app

import okhttp3.HttpUrl
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class ResolverBundleRepositoryTest {
    @get:Rule val folder = TemporaryFolder()

    // Produced by Node crypto.sign with ieee-p1363, not the Java provider under test.
    private val spki = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvlFXX7FuJMO95Wtj1F0Qx9WxkyhRNnPW+QuSh+B0DQ6gOHzFfGm8LfSEZqEw9MAIPGnlujXsnTLSvLrNNkK0mQ=="
    private val keys = mapOf("test" to spki)
    private val code = "42;".toByteArray()
    private fun manifest(version: Long): ByteArray {
        val signature = when (version) {
            12L -> "GvN41kqFYPkm4vM/ZFXua4omY//frLfne0LcLjaDI8ArKCGX79IdFaKjwA4wxA+uDmLyhHHDpNoWeew8BpmsIQ=="
            13L -> "xB5PhBwRegZD8m8Hz9pyPeqnGSMcX0QtugYdOt4Wt2b2QbLlConB24GdDYEOm6qZNCrTldSdVMqsJeW2wabbTA=="
            else -> error("No vector")
        }
        return """{"version":$version,"abi":"androidx-js-1","keyId":"test","artifactPath":"/resolvers/v2/$version/resolver.js","byteLength":3,"sha256Hex":"fa8571fdfcea0148b09bb44116aa412259b96c4f832d7a0b7d0ddec450083425","signature":"$signature"}""".toByteArray()
    }

    @Test fun acceptsNodeSignatureAndExactCode() {
        val trust = ResolverBundleTrust(keys)
        val verified = trust.verifyManifest(manifest(12))
        assertEquals(12L, verified.version)
        trust.verifyCode(verified, code)
        assertThrows(IllegalArgumentException::class.java) { trust.verifyCode(verified, "43;".toByteArray()) }
        assertThrows(IllegalArgumentException::class.java) { trust.verifyCode(verified, "42".toByteArray()) }
    }

    @Test fun rejectsWrongPublicKey() {
        val pair = java.security.KeyPairGenerator.getInstance("EC").apply {
            initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val wrong = java.util.Base64.getEncoder().encodeToString(pair.public.encoded)
        assertThrows(IllegalArgumentException::class.java) { ResolverBundleTrust(mapOf("test" to wrong)).verifyManifest(manifest(12)) }
    }

    @Test fun rejectsInvalidSchemaAndOversize() {
        val trust = ResolverBundleTrust(keys)
        val good = manifest(12).decodeToString()
        for (input in listOf("<html>SPA fallback</html>", "{}", good + "{}", good.replace("androidx-js-1", "unknown"),
            good.replace("\"version\":12", "\"version\":12,\"version\":12"), good.replace("\"version\":12", "\"version\":\"12\""),
            good.replace("\"byteLength\":3", "\"byteLength\":3000001"), good + " ".repeat(4096))) {
            assertThrows(Exception::class.java) { trust.verifyManifest(input.toByteArray()) }
        }
    }

    private var version = 12L
    private var now = 0L
    private var downloads = 0
    private fun fetch(url: HttpUrl, cap: Int, mime: Set<String>): ByteArray {
        downloads++
        return if (url.encodedPath.endsWith("manifest.json")) {
            assertEquals(RESOLVER_MANIFEST_LIMIT, cap)
            assertEquals(setOf("application/json"), mime)
            manifest(version)
        } else {
            assertEquals("/resolvers/v2/$version/resolver.js", url.encodedPath)
            assertEquals(3, cap)
            code
        }
    }

    private fun repository(dir: File) = ResolverBundleRepository(dir, keys, clockMs = { now }, download = ::fetch)

    @Test fun durableHighWaterAndQuarantinePreserveGood() {
        val dir = folder.newFolder()
        val repo = repository(dir)
        assertTrue(repo.refresh())
        assertTrue(repo.promote(12))
        assertFalse(repo.refresh())
        assertEquals(2, downloads)
        now += 900_000
        version = 13
        assertTrue(repo.refresh())
        assertEquals(13L, repo.load()!!.version)
        assertFalse(repo.recordFailure(13))
        val reopened = repository(dir)
        assertTrue(reopened.recordFailure(13))
        assertEquals(12L, reopened.load()!!.version)
        assertFalse(reopened.refresh()) // same high-water
        now += 900_000
        version = 12
        assertFalse(reopened.refresh()) // rollback
        assertEquals(12L, reopened.load()!!.version)
    }

    @Test fun corruptCandidateCannotPromoteOrReplaceGood() {
        val dir = folder.newFolder()
        val repo = repository(dir)
        assertTrue(repo.refresh())
        assertTrue(repo.promote(12))
        now += 900_000
        version = 13
        assertTrue(repo.refresh())
        File(dir, "13.js").writeText("43;")
        assertFalse(repo.promote(13))
        assertEquals(12L, repository(dir).load()!!.version)
    }

    @Test fun interruptedPublicationKeepsGoodAndIgnoresTornTemporary() {
        val dir = folder.newFolder()
        val repo = repository(dir)
        assertTrue(repo.refresh())
        assertTrue(repo.promote(12))
        version = 13
        val interrupted = ResolverBundleRepository(dir, keys, download = ::fetch, atomicWrite = { file, bytes ->
            if (file.name == "state") {
                File(dir, ".state.tmp").writeText("13,")
                throw IOException("Interrupted before atomic state move")
            }
            file.writeBytes(bytes)
        })
        assertFalse(interrupted.refresh())
        val reopened = repository(dir)
        assertEquals(12L, reopened.load()!!.version)
        assertTrue(reopened.refresh())
        assertEquals(13L, reopened.load()!!.version)
    }

    @Test fun doesNotQuarantineSoleCandidateWithoutFallbackUnlessFallbackConfirmed() {
        val dir = folder.newFolder()
        version = 12
        val repo = repository(dir)
        assertTrue(repo.refresh())
        assertEquals(12L, repo.load()!!.version)

        // With good == 0 and no baseline, transient/unconfirmed failures must not quarantine sole bundle.
        assertFalse(repo.recordFailure(12))
        assertFalse(repo.recordFailure(12))
        assertFalse(repo.recordFailure(12))
        assertEquals(12L, repository(dir).load()!!.version)

        // When caller confirms an alternate fallback succeeded online, repeated faults do quarantine.
        assertFalse(repo.recordFailure(12, fallbackSucceeded = true))
        assertTrue(repo.recordFailure(12, fallbackSucceeded = true))
        assertNull(repository(dir).load())
    }

    @Test fun quarantinesCandidateToVerifiedBaselineWhenGoodIsZero() {
        val dir = folder.newFolder()
        version = 13
        val repo = ResolverBundleRepository(
            directory = dir,
            pinnedKeys = keys,
            baseline = manifest(12) to code,
            clockMs = { now },
            download = ::fetch,
        )
        assertTrue(repo.refresh())
        assertEquals(13L, repo.load()!!.version)
        assertFalse(repo.recordFailure(13))
        assertTrue(repo.recordFailure(13))
        assertEquals(12L, repo.load()!!.version)
    }
}
