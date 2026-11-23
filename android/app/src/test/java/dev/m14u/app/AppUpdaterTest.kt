package dev.m14u.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {

    @Test
    fun testRepoValidation() {
        assertTrue(AppUpdater.isValidRepo("devsanthoshmk/m14u-workers-v4"))
        assertTrue(AppUpdater.isValidRepo("owner/repo.name"))
        assertTrue(AppUpdater.isValidRepo("user-name/repo-123"))

        assertFalse(AppUpdater.isValidRepo(null))
        assertFalse(AppUpdater.isValidRepo(""))
        assertFalse(AppUpdater.isValidRepo("   "))
        assertFalse(AppUpdater.isValidRepo("invalid"))
        assertFalse(AppUpdater.isValidRepo("owner/repo/extra"))
        assertFalse(AppUpdater.isValidRepo("owner/../repo"))
        assertFalse(AppUpdater.isValidRepo("https://github.com/owner/repo"))
    }

    @Test
    fun testStableReleasePolicy() {
        assertTrue(AppUpdater.isStableRelease("v1.0.1", isPrerelease = false, isDraft = false))
        assertTrue(AppUpdater.isStableRelease("1.2.0", isPrerelease = false, isDraft = false))
        assertTrue(AppUpdater.isStableRelease("V2.0", isPrerelease = false, isDraft = false))

        assertFalse(AppUpdater.isStableRelease("v1.0.1", isPrerelease = true, isDraft = false))
        assertFalse(AppUpdater.isStableRelease("v1.0.1", isPrerelease = false, isDraft = true))
        assertFalse(AppUpdater.isStableRelease("v1.0.1-rc1", isPrerelease = false, isDraft = false))
        assertFalse(AppUpdater.isStableRelease("1.0.0-beta", isPrerelease = false, isDraft = false))
        assertFalse(AppUpdater.isStableRelease("v1.0-alpha.2", isPrerelease = false, isDraft = false))
        assertFalse(AppUpdater.isStableRelease("", isPrerelease = false, isDraft = false))
    }

    @Test
    fun testStrictlyNewerComparison() {
        // Strictly newer
        assertTrue(AppUpdater.isStrictlyNewer("1.0.1", "1.0"))
        assertTrue(AppUpdater.isStrictlyNewer("v1.1", "1.0.9"))
        assertTrue(AppUpdater.isStrictlyNewer("2.0.0", "1.9.9"))
        assertTrue(AppUpdater.isStrictlyNewer("1.0.0.1", "1.0"))
        assertTrue(AppUpdater.isStrictlyNewer("1.1", "1.0"))

        // Equal (not strictly newer)
        assertFalse(AppUpdater.isStrictlyNewer("1.0", "1.0"))
        assertFalse(AppUpdater.isStrictlyNewer("1.0.0", "1.0"))
        assertFalse(AppUpdater.isStrictlyNewer("v1.0", "1.0.0"))
        assertFalse(AppUpdater.isStrictlyNewer("1.0", "1.0.0"))

        // Older (not strictly newer)
        assertFalse(AppUpdater.isStrictlyNewer("0.9.9", "1.0"))
        assertFalse(AppUpdater.isStrictlyNewer("1.0.0", "1.0.1"))
        assertFalse(AppUpdater.isStrictlyNewer("1.0", "1.1"))
    }

    @Test
    fun testTrustedDownloadUrl() {
        assertTrue(AppUpdater.isTrustedDownloadUrl("https://github.com/devsanthoshmk/m14u-workers-v4/releases/download/v1.1/app-debug.apk"))
        assertTrue(AppUpdater.isTrustedDownloadUrl("https://objects.githubusercontent.com/github-production-release-asset-2e65be/12345/app.apk"))

        assertFalse(AppUpdater.isTrustedDownloadUrl("http://github.com/devsanthoshmk/m14u-workers-v4/releases/download/v1.1/app-debug.apk"))
        assertFalse(AppUpdater.isTrustedDownloadUrl("https://malicious.example.com/app.apk"))
        assertFalse(AppUpdater.isTrustedDownloadUrl("not-a-url"))
    }
}
