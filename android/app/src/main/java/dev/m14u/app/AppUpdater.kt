package dev.m14u.app

import android.content.Intent
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Checks GitHub Releases for a newer APK and prompts the user to update.
 * This ensures the app (and its bundled NewPipeExtractor) stays current.
 *
 * Set GITHUB_REPO to your repo (e.g., "user/M14U-android").
 * Create GitHub releases with a tag like "v1.1" and attach the APK.
 */
@CapacitorPlugin(name = "AppUpdater")
class AppUpdater : Plugin() {

    companion object {
        private const val TAG = "AppUpdater"
        // TODO: Set this to your actual GitHub repo
        private const val GITHUB_REPO = "santhoshmk/M14U-android"
        private const val CURRENT_VERSION = "1.0.0"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val request = Request.Builder()
                    .url("https://api.github.com/repos/$GITHUB_REPO/releases/latest")
                    .header("Accept", "application/vnd.github.v3+json")
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: "{}"
                val json = JSONObject(body)

                val latestTag = json.optString("tag_name", "").removePrefix("v")
                val downloadUrl = json.optJSONArray("assets")
                    ?.let { assets ->
                        for (i in 0 until assets.length()) {
                            val asset = assets.getJSONObject(i)
                            if (asset.getString("name").endsWith(".apk")) {
                                return@let asset.getString("browser_download_url")
                            }
                        }
                        null
                    }

                val hasUpdate = latestTag.isNotEmpty() && latestTag != CURRENT_VERSION
                val result = JSObject().apply {
                    put("hasUpdate", hasUpdate)
                    put("currentVersion", CURRENT_VERSION)
                    put("latestVersion", latestTag)
                    put("downloadUrl", downloadUrl ?: "")
                    put("releaseNotes", json.optString("body", ""))
                }

                Log.d(TAG, "Update check: current=$CURRENT_VERSION, latest=$latestTag, hasUpdate=$hasUpdate")
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                Log.e(TAG, "Update check failed", e)
                withContext(Dispatchers.Main) {
                    val result = JSObject().apply {
                        put("hasUpdate", false)
                        put("currentVersion", CURRENT_VERSION)
                        put("error", e.message)
                    }
                    call.resolve(result)
                }
            }
        }
    }

    @PluginMethod
    fun openDownloadUrl(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrEmpty()) {
            call.reject("url is required")
            return
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        activity.startActivity(intent)
        call.resolve()
    }
}
