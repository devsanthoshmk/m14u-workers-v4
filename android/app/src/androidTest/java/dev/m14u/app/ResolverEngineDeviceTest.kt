package dev.m14u.app

import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptSandbox
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ResolverEngineDeviceTest {
    private val appContext get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val testAssets get() = InstrumentationRegistry.getInstrumentation().context.assets

    @Test
    fun sandboxRepositoryEngineRangeOpenAndFaultRecovery() {
        assertTrue("Expected API >= 26 on test device", Build.VERSION.SDK_INT >= 26)
        assertTrue("JavaScriptSandbox.isSupported() must be true", JavaScriptSandbox.isSupported())

        // (a) Verify JavaScriptSandbox features on device.
        val features = listOf(
            JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,
            JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT,
            JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
            JavaScriptSandbox.JS_FEATURE_WASM_COMPILATION,
            JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE,
            JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION,
            JavaScriptSandbox.JS_FEATURE_CONSOLE_MESSAGING,
            JavaScriptSandbox.JS_FEATURE_EVALUATE_FROM_FD,
        )
        val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(appContext).get(5, TimeUnit.SECONDS)
        val supported = try {
            features.associateWith { sandbox.isFeatureSupported(it) }
        } finally {
            sandbox.close()
        }
        Log.i(TAG, "Device SDK=${Build.VERSION.SDK_INT} WebViewFeatures=$supported")
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN))
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT))
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER))
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_WASM_COMPILATION))
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE))
        assertTrue(supported.getValue(JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION))

        // Load signed v2 test fixture packaged only in androidTest APK.
        val hasSpikeAssets = runCatching { testAssets.open("manifest.json").close(); true }.getOrDefault(false)
        assumeTrue("Spike assets missing from /tmp/opencode/m14u-t3-bundle", hasSpikeAssets)
        val spkiB64 = testAssets.open("public-spki.b64").use { it.readBytes() }.decodeToString().trim()
        val manifestBytes = testAssets.open("manifest.json").use { it.readBytes() }
        val manifestJson = JSONObject(manifestBytes.decodeToString())
        val keyId = manifestJson.getString("keyId")
        val version = manifestJson.getLong("version")
        val artifactBytes = testAssets.open("$version/resolver.js").use { it.readBytes() }
        Log.i(TAG, "Loaded test bundle v$version bytes=${artifactBytes.size}")

        // (b) Verify ResolverBundleRepository on real Android noBackupFilesDir (with real fsync).
        val root = File(appContext.noBackupFilesDir, "t3-device-spike-${System.nanoTime()}")
        root.mkdirs()
        try {
            val wrongKey = KeyPairGenerator.getInstance("EC").apply {
                initialize(ECGenParameterSpec("secp256r1"))
            }.generateKeyPair().public.encoded.let { Base64.getEncoder().encodeToString(it) }
            val wrongRepo = ResolverBundleRepository(
                directory = File(root, "wrong-key"),
                pinnedKeys = mapOf(keyId to wrongKey),
                download = { url, _, _ ->
                    if (url.encodedPath.endsWith("manifest.json")) manifestBytes else artifactBytes
                },
            )
            assertFalse("Wrong public key must be rejected", wrongRepo.refresh())
            assertNull(wrongRepo.load())

            val tamperedRepo = ResolverBundleRepository(
                directory = File(root, "tampered"),
                pinnedKeys = mapOf(keyId to spkiB64),
                download = { url, _, _ ->
                    if (url.encodedPath.endsWith("manifest.json")) {
                        manifestBytes
                    } else {
                        artifactBytes.copyOf().also { it[0] = (it[0].toInt() xor 0x20).toByte() }
                    }
                },
            )
            assertFalse("Tampered artifact must be rejected", tamperedRepo.refresh())
            assertNull(tamperedRepo.load())

            val repoDir = File(root, "valid")
            val validKeys = mapOf(keyId to spkiB64)
            fun serveValid(url: HttpUrl, @Suppress("UNUSED_PARAMETER") cap: Int, @Suppress("UNUSED_PARAMETER") mime: Set<String>): ByteArray =
                if (url.encodedPath.endsWith("manifest.json")) manifestBytes else artifactBytes

            val repo = ResolverBundleRepository(repoDir, validKeys, download = ::serveValid)
            assertTrue("Valid signed v2 bundle must stage cleanly", repo.refresh())
            val loaded = repo.load()
            assertNotNull(loaded)
            assertEquals(version, loaded!!.version)
            assertTrue("Promote must succeed for valid candidate", repo.promote(version))

            val reopened = ResolverBundleRepository(repoDir, validKeys, download = ::serveValid)
            val reloaded = reopened.load()
            assertNotNull(reloaded)
            assertEquals(version, reloaded!!.version)

            // Verify disk re-check catches on-disk tampering.
            File(repoDir, "$version.js").appendText("\n;/*tamper*/")
            assertNull("Tampered on-disk artifact must fail re-verification", reopened.load())

            // Verify QuickJS WASM selfTest inside JavaScriptSandbox.
            val wasmSandbox = JavaScriptSandbox.createConnectedInstanceAsync(appContext).get(5, TimeUnit.SECONDS)
            try {
                val params = IsolateStartupParameters().apply {
                    setMaxHeapSizeBytes(64L * 1024 * 1024)
                    setMaxEvaluationReturnSizeBytes(512 * 1024)
                }
                wasmSandbox.createIsolate(params).use { isolate ->
                    val wasmStart = SystemClock.elapsedRealtime()
                    isolate.evaluateJavaScriptAsync("${loaded.code}\n;'ready'").get(5, TimeUnit.SECONDS)
                    val selfTest = isolate.evaluateJavaScriptAsync("m14uResolver.selfTest()").get(5, TimeUnit.SECONDS)
                    val wasmMs = SystemClock.elapsedRealtime() - wasmStart
                    assertEquals("42", selfTest)
                    Log.i(TAG, "QuickJS WASM selfTest=42 in ${wasmMs}ms")
                }
            } finally {
                wasmSandbox.close()
            }

            // (c) Resolve two real tracks via ResolverEngine (cold & warm latency).
            val mediaClient = OkHttpClient.Builder()
                .callTimeout(15, TimeUnit.SECONDS)
                .build()

            ResolverEngine(appContext).use { engine ->
                assertTrue(engine.isSupported())

                val coldStart = SystemClock.elapsedRealtime()
                val coldRaw = engine.resolve(loaded, "pIWaVJPl0-c")!!.get(15, TimeUnit.SECONDS)
                val coldMs = SystemClock.elapsedRealtime() - coldStart
                assertNotNull("Cold resolve for pIWaVJPl0-c returned null", coldRaw)
                val coldFormat = assertValidAudioResult("pIWaVJPl0-c", coldRaw!!, coldMs)

                val warmStart = SystemClock.elapsedRealtime()
                val warmRaw = engine.resolve(loaded, "dQw4w9WgXcQ")!!.get(15, TimeUnit.SECONDS)
                val warmMs = SystemClock.elapsedRealtime() - warmStart
                assertNotNull("Warm resolve for dQw4w9WgXcQ returned null", warmRaw)
                val warmFormat = assertValidAudioResult("dQw4w9WgXcQ", warmRaw!!, warmMs)

                // (d) Real media range-open check (no-Range progressive GET + Range: bytes=0-65535).
                verifyMediaOpen(mediaClient, "pIWaVJPl0-c", coldFormat.url)
                verifyMediaOpen(mediaClient, "dQw4w9WgXcQ", warmFormat.url)

                // (e) Fault & recovery check: infinite loop timeout + JS throw, then clean recovery.
                val loopStart = SystemClock.elapsedRealtime()
                val loopBundle = ResolverBundleRepository.Bundle(999L, "while (true) {}")
                val loopResult = engine.resolve(loopBundle, "pIWaVJPl0-c", timeoutMs = 800L)!!.get(5, TimeUnit.SECONDS)
                val loopMs = SystemClock.elapsedRealtime() - loopStart
                assertNull("Timed-out isolate must return null", loopResult)
                Log.i(TAG, "Fault timeout recovered in ${loopMs}ms")

                val throwBundle = ResolverBundleRepository.Bundle(998L, "throw new Error('boom');")
                val throwResult = engine.resolve(throwBundle, "pIWaVJPl0-c", timeoutMs = 3000L)!!.get(5, TimeUnit.SECONDS)
                assertNull("Throwing bundle must return null", throwResult)

                val recoverStart = SystemClock.elapsedRealtime()
                val recoverRaw = engine.resolve(loaded, "pIWaVJPl0-c")!!.get(15, TimeUnit.SECONDS)
                val recoverMs = SystemClock.elapsedRealtime() - recoverStart
                assertNotNull("Engine must recover after isolate timeout/crash", recoverRaw)
                assertValidAudioResult("pIWaVJPl0-c-recovered", recoverRaw!!, recoverMs)
            }
        } finally {
            root.deleteRecursively()
        }
    }

    private data class FormatInfo(val url: String, val type: String, val bitrate: String)

    private fun assertValidAudioResult(label: String, rawJson: String, elapsedMs: Long): FormatInfo {
        val json = JSONObject(rawJson)
        val title = json.optString("title", "")
        val formats = json.getJSONArray("adaptiveFormats")
        assertTrue("$label must have at least one adaptiveFormat", formats.length() > 0)
        var picked: FormatInfo? = null
        for (i in 0 until formats.length()) {
            val item = formats.getJSONObject(i)
            val url = item.getString("url")
            val type = item.getString("type")
            val bitrate = item.getString("bitrate")
            val uri = Uri.parse(url)
            assertEquals("https", uri.scheme)
            assertTrue("Unexpected stream host: ${uri.host}", uri.host?.endsWith(".googlevideo.com") == true)
            assertTrue("Unexpected MIME type: $type", type.startsWith("audio/"))
            if (picked == null || type.startsWith("audio/mp4")) {
                picked = FormatInfo(url, type, bitrate)
            }
        }
        val chosen = picked!!
        val host = Uri.parse(chosen.url).host
        Log.i(TAG, "Resolved $label in ${elapsedMs}ms titleLen=${title.length} formats=${formats.length()} host=$host mime=${chosen.type} bitrate=${chosen.bitrate}")
        return chosen
    }

    private fun verifyMediaOpen(client: OkHttpClient, label: String, url: String) {
        val host = Uri.parse(url).host

        // 1. Progressive GET without Range header (mirrors ExoPlayer DefaultHttpDataSource initial open).
        val progressiveReq = Request.Builder().url(url).get().build()
        client.newCall(progressiveReq).execute().use { response ->
            val mime = response.header("Content-Type") ?: ""
            assertEquals("$label progressive GET expected HTTP 200", 200, response.code)
            assertTrue("$label progressive GET expected audio/* MIME, got $mime", mime.startsWith("audio/"))
            val buffer = ByteArray(65_536)
            val stream = response.body!!.byteStream()
            var read = 0
            while (read < 16_384) {
                val n = stream.read(buffer, read, buffer.size - read)
                if (n <= 0) break
                read += n
            }
            assertTrue("$label progressive GET expected >= 16384 bytes, got $read", read >= 16_384)
            Log.i(TAG, "Media open $label progressive=200 host=$host mime=$mime read=$read")
        }

        // 2. Explicit Range GET (bytes=0-65535).
        val rangeReq = Request.Builder().url(url).header("Range", "bytes=0-65535").get().build()
        client.newCall(rangeReq).execute().use { response ->
            val mime = response.header("Content-Type") ?: ""
            assertTrue("$label Range GET expected 206/200, got ${response.code}", response.code == 206 || response.code == 200)
            assertTrue("$label Range GET expected audio/* MIME, got $mime", mime.startsWith("audio/"))
            val bytes = response.body!!.bytes()
            assertEquals("$label Range GET expected 65536 bytes", 65_536, bytes.size)
            Log.i(TAG, "Media open $label range=${response.code} host=$host mime=$mime bytes=${bytes.size}")
        }
    }

    private companion object {
        const val TAG = "ResolverDeviceTest"
    }
}
