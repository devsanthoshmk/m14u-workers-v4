package dev.m14u.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

/**
 * Checks GitHub Releases for a newer APK and prompts the user to update.
 * Enforces:
 * - Dynamic installed version lookup from PackageManager
 * - Stable, strictly newer releases only (semver comparison, filtering drafts/prereleases)
 * - Explicit repository policy and trusted download host validation
 */
@CapacitorPlugin(name = "AppUpdater")
class AppUpdater : Plugin() {

    companion object {
        private const val TAG = "AppUpdater"
        const val DEFAULT_REPO = "devsanthoshmk/m14u-workers-v4"
        const val FALLBACK_VERSION = "1.0"
        private val REPO_PATTERN = Pattern.compile("^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$")

        /**
         * Validates whether a repo string adheres to GitHub's owner/repo syntax.
         */
        fun isValidRepo(repo: String?): Boolean {
            if (repo.isNullOrBlank()) return false
            return REPO_PATTERN.matcher(repo.trim()).matches()
        }

        /**
         * Checks if a release tag or release flags indicate a stable release.
         * Excludes pre-releases, drafts, and tags with pre-release suffixes (e.g. "-beta", "-rc").
         */
        fun isStableRelease(tag: String, isPrerelease: Boolean, isDraft: Boolean): Boolean {
            if (isPrerelease || isDraft) return false
            val clean = tag.trim().removePrefix("v").removePrefix("V")
            if (clean.isEmpty()) return false
            if (clean.contains("-")) return false
            return true
        }

        /**
         * Compares two semantic version strings to determine if candidate is strictly newer than current.
         * Example: "1.0.1" > "1.0" -> true, "1.0.0" > "1.0" -> false, "0.9.9" > "1.0" -> false.
         */
        fun isStrictlyNewer(candidateVersion: String, currentVersion: String): Boolean {
            val candidateParts = parseVersionParts(candidateVersion)
            val currentParts = parseVersionParts(currentVersion)
            if (candidateParts.isEmpty() && currentParts.isEmpty()) return false

            val maxLen = maxOf(candidateParts.size, currentParts.size)
            for (i in 0 until maxLen) {
                val cPart = candidateParts.getOrElse(i) { 0 }
                val currPart = currentParts.getOrElse(i) { 0 }
                if (cPart > currPart) return true
                if (cPart < currPart) return false
            }
            return false
        }

        private fun parseVersionParts(version: String): List<Int> {
            val clean = version.trim()
                .removePrefix("v")
                .removePrefix("V")
                .substringBefore('-')
                .substringBefore('+')
            if (clean.isEmpty()) return emptyList()

            return clean.split('.')
                .map { part -> part.toIntOrNull() ?: 0 }
        }

        /**
         * Verifies that the download URL is an HTTPS URL from a trusted GitHub release domain.
         */
        fun isTrustedDownloadUrl(url: String): Boolean {
            return try {
                val uri = URI(url)
                if (!"https".equals(uri.scheme, ignoreCase = true)) return false
                val host = uri.host?.lowercase() ?: return false
                host == "github.com" ||
                        host.endsWith(".github.com") ||
                        host == "githubusercontent.com" ||
                        host.endsWith(".githubusercontent.com")
            } catch (_: Exception) {
                false
            }
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun getInstalledVersion(): String {
        return try {
            val ctx = context ?: return FALLBACK_VERSION
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            }
            packageInfo.versionName ?: FALLBACK_VERSION
        } catch (e: Exception) {
            Log.w(TAG, "Failed to resolve installed package version", e)
            FALLBACK_VERSION
        }
    }

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        val requestedRepo = call.getString("repo")
        val repo = if (!requestedRepo.isNullOrBlank()) {
            if (!isValidRepo(requestedRepo)) {
                call.reject("Invalid GitHub repository format. Expected 'owner/repo'.")
                return
            }
            requestedRepo.trim()
        } else {
            DEFAULT_REPO
        }

        val currentVersion = getInstalledVersion()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val request = Request.Builder()
                    .url("https://api.github.com/repos/$repo/releases/latest")
                    .header("Accept", "application/vnd.github.v3+json")
                    .build()

                val callResponse = client.newCall(request).execute()
                val (responseCode, responseBody) = callResponse.use { resp ->
                    Pair(resp.code, resp.body?.string())
                }

                if (responseCode == 404) {
                    val result = JSObject().apply {
                        put("hasUpdate", false)
                        put("currentVersion", currentVersion)
                        put("latestVersion", "")
                        put("downloadUrl", "")
                        put("releaseNotes", "")
                    }
                    Log.d(TAG, "No releases published for repo: $repo")
                    withContext(Dispatchers.Main) { call.resolve(result) }
                    return@launch
                }

                if (responseCode !in 200..299) {
                    throw IOException("Release lookup failed (HTTP $responseCode)")
                }

                val json = JSONObject(responseBody ?: throw IOException("Release lookup returned empty response"))

                val isPrerelease = json.optBoolean("prerelease", false)
                val isDraft = json.optBoolean("draft", false)
                val rawTag = json.optString("tag_name", "")
                val cleanTag = rawTag.removePrefix("v").removePrefix("V").trim()

                val downloadUrl = json.optJSONArray("assets")
                    ?.let { assets ->
                        for (i in 0 until assets.length()) {
                            val asset = assets.getJSONObject(i)
                            val name = asset.optString("name", "")
                            if (name.endsWith(".apk", ignoreCase = true)) {
                                return@let asset.optString("browser_download_url", "")
                            }
                        }
                        null
                    }

                val isStable = isStableRelease(rawTag, isPrerelease, isDraft)
                val isNewer = isStrictlyNewer(cleanTag, currentVersion)
                val hasUpdate = isStable && isNewer && !downloadUrl.isNullOrBlank()

                val result = JSObject().apply {
                    put("hasUpdate", hasUpdate)
                    put("currentVersion", currentVersion)
                    put("latestVersion", cleanTag)
                    put("downloadUrl", downloadUrl ?: "")
                    put("releaseNotes", json.optString("body", ""))
                }

                Log.d(TAG, "Update check: repo=$repo, current=$currentVersion, latest=$cleanTag, stable=$isStable, newer=$isNewer, hasUpdate=$hasUpdate")
                withContext(Dispatchers.Main) { call.resolve(result) }
            } catch (e: Exception) {
                Log.e(TAG, "Update check failed", e)
                withContext(Dispatchers.Main) {
                    val result = JSObject().apply {
                        put("hasUpdate", false)
                        put("currentVersion", currentVersion)
                        put("error", e.message ?: "Update check failed")
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
        if (!isTrustedDownloadUrl(url)) {
            call.reject("An HTTPS download URL from a trusted GitHub domain is required")
            return
        }
        val uri = Uri.parse(url)
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
                call.resolve()
            } catch (e: ActivityNotFoundException) {
                call.reject("No app can open the download URL", e)
            }
        }
    }
}
