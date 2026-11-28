package dev.m14u.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.webkit.WebViewClient;
import dev.m14u.app.MainActivity.OfflineFallbackPolicy;
import org.junit.Test;

public class MainActivityOfflineTest {

    private static final String PROD_SERVER = "https://m14u.pages.dev";
    private static final String DEBUG_SERVER = "http://127.0.0.1:5173";

    @Test
    public void mainFrameErrorOnConfiguredOriginTriggersFallback() {
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_HOST_LOOKUP));
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/search?q=lofi", PROD_SERVER, WebViewClient.ERROR_CONNECT));
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev:443/", PROD_SERVER, WebViewClient.ERROR_TIMEOUT));
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "http://127.0.0.1:5173/", DEBUG_SERVER, WebViewClient.ERROR_IO));
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true,
                "https://m14u.pages.dev/",
                PROD_SERVER,
                WebViewClient.ERROR_UNKNOWN,
                "net::ERR_INTERNET_DISCONNECTED"));
    }

    @Test
    public void abortedAndNonOfflineErrorCodesAreIgnored() {
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_UNKNOWN));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_UNKNOWN, "net::ERR_ABORTED"));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, OfflineFallbackPolicy.ERROR_CODE_ABORTED));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_HOST_LOOKUP, "net::ERR_ABORTED"));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_FAILED_SSL_HANDSHAKE));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_UNSUPPORTED_SCHEME));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, "https://m14u.pages.dev/", PROD_SERVER, WebViewClient.ERROR_REDIRECT_LOOP));
    }

    @Test
    public void subresourceErrorsNeverTriggerFallback() {
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                false, "https://m14u.pages.dev/assets/app.js", PROD_SERVER, WebViewClient.ERROR_HOST_LOOKUP));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                false, "https://m14u.pages.dev/favicon.ico", PROD_SERVER, WebViewClient.ERROR_CONNECT));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                false, "https://i.ytimg.com/vi/abc/hqdefault.jpg", PROD_SERVER, WebViewClient.ERROR_TIMEOUT));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                false, "http://127.0.0.1:5173/api/search?q=test", DEBUG_SERVER, WebViewClient.ERROR_IO));
    }

    @Test
    public void httpErrorsOnlyFallbackOnMainFrame5xxForConfiguredOrigin() {
        // Subresource 4xx/5xx must never trigger offline fallback
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                false, 404, "https://m14u.pages.dev/missing.png", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                false, 500, "https://m14u.pages.dev/api/search", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                false, 503, "https://api.example.com/stream", PROD_SERVER));

        // Main-frame 4xx should not trigger offline fallback
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                true, 404, "https://m14u.pages.dev/unknown", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                true, 403, "https://m14u.pages.dev/", PROD_SERVER));

        // Main-frame 5xx on configured origin triggers fallback; external origin does not
        assertTrue(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                true, 502, "https://m14u.pages.dev/", PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                true, 503, "http://127.0.0.1:5173/", DEBUG_SERVER));
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                true, 503, "https://evil.example.com/", PROD_SERVER));
    }

    @Test
    public void offlineAssetUrlNeverTriggersReloadLoop() {
        String offlineUrl = OfflineFallbackPolicy.buildOfflinePageUrl(PROD_SERVER, false);
        String failedOfflineUrl = OfflineFallbackPolicy.buildOfflinePageUrl(PROD_SERVER, true);

        assertTrue(OfflineFallbackPolicy.isOfflineAssetUrl(OfflineFallbackPolicy.OFFLINE_ASSET_URL));
        assertTrue(OfflineFallbackPolicy.isOfflineAssetUrl(offlineUrl));
        assertTrue(OfflineFallbackPolicy.isOfflineAssetUrl(failedOfflineUrl));
        assertTrue(OfflineFallbackPolicy.isOfflineAssetUrl(offlineUrl + "&extra={a}|[b]^c"));
        assertFalse(OfflineFallbackPolicy.isOfflineAssetUrl("file://evil/android_asset/public/offline.html"));
        assertFalse(OfflineFallbackPolicy.isOfflineAssetUrl("file:///android_asset/public/index.html"));
        assertFalse(OfflineFallbackPolicy.isOfflineAssetUrl("https://m14u.pages.dev/offline.html"));

        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, offlineUrl, PROD_SERVER, WebViewClient.ERROR_HOST_LOOKUP));
        assertFalse(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, failedOfflineUrl, PROD_SERVER, WebViewClient.ERROR_CONNECT));
        assertFalse(OfflineFallbackPolicy.shouldShowHttpErrorFallback(true, 500, offlineUrl, PROD_SERVER));
    }

    @Test
    public void originAllowlistRejectsSpoofingPortsSchemesAndUserinfo() {
        assertTrue(OfflineFallbackPolicy.isSameOrigin("https://M14U.PAGES.DEV/library", PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev:443", PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.isSameOrigin("http://127.0.0.1:5173/index.html", DEBUG_SERVER));
        assertTrue(OfflineFallbackPolicy.isSameOrigin("http://[::1]:5173/index.html", "http://[::1]:5173"));

        assertFalse(OfflineFallbackPolicy.isSameOrigin("http://m14u.pages.dev/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev:8443/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://sub.m14u.pages.dev/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev.evil.com/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev@evil.com/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://user:pass@m14u.pages.dev/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://evil.com\\@m14u.pages.dev/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("http://127.0.0.1:8080/", DEBUG_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("http://localhost:5173/", DEBUG_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev:0/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://m14u.pages.dev:70000/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("javascript:alert(1)", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(null, PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(PROD_SERVER, null));
    }

    @Test
    public void unescapedQueryAndFragmentCharactersDoNotBypassOriginChecks() {
        String validPipeBraceQuery = "https://m14u.pages.dev/search?q=a|b&meta={foo}^[0]#frag|{x}";
        assertTrue(OfflineFallbackPolicy.isHttpOrHttps(validPipeBraceQuery));
        assertTrue(OfflineFallbackPolicy.hasSameSchemeAndHost(validPipeBraceQuery, PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.isSameOrigin(validPipeBraceQuery, PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.shouldShowOfflineFallback(
                true, validPipeBraceQuery, PROD_SERVER, WebViewClient.ERROR_CONNECT));
        assertFalse(OfflineFallbackPolicy.hasDisallowedAuthority(validPipeBraceQuery));

        String badPortWithPipeQuery = "http://127.0.0.1:8080/search?q=a|b&meta={foo}^[0]";
        assertTrue(OfflineFallbackPolicy.isHttpOrHttps(badPortWithPipeQuery));
        assertTrue(OfflineFallbackPolicy.hasSameSchemeAndHost(badPortWithPipeQuery, DEBUG_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(badPortWithPipeQuery, DEBUG_SERVER));

        String userinfoWithBraceQuery = "https://user:pass@m14u.pages.dev/?x={1}|[2]^3";
        assertTrue(OfflineFallbackPolicy.isHttpOrHttps(userinfoWithBraceQuery));
        assertTrue(OfflineFallbackPolicy.hasDisallowedAuthority(userinfoWithBraceQuery));
        assertTrue(OfflineFallbackPolicy.hasSameSchemeAndHost(userinfoWithBraceQuery, PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(userinfoWithBraceQuery, PROD_SERVER));

        String externalUserinfo = "https://m14u.pages.dev@evil.com/?x={1}|[2]";
        assertTrue(OfflineFallbackPolicy.isHttpOrHttps(externalUserinfo));
        assertTrue(OfflineFallbackPolicy.hasDisallowedAuthority(externalUserinfo));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(externalUserinfo, PROD_SERVER));

        String backslashAuthority = "https://evil.com\\@m14u.pages.dev/?x={1}";
        assertTrue(OfflineFallbackPolicy.hasDisallowedAuthority(backslashAuthority));
        assertFalse(OfflineFallbackPolicy.isSameOrigin(backslashAuthority, PROD_SERVER));
    }

    @Test
    public void retryNavigationValidationBlocksArbitraryUrlsAndPaths() {
        assertTrue(OfflineFallbackPolicy.isAllowedRetryNavigation("https://m14u.pages.dev", PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.isAllowedRetryNavigation("https://m14u.pages.dev/", PROD_SERVER));
        assertTrue(OfflineFallbackPolicy.isAllowedRetryNavigation("http://127.0.0.1:5173/", DEBUG_SERVER));

        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("https://evil.com/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("https://m14u.pages.dev/injected?x=1", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("https://m14u.pages.dev@evil.com/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("file:///android_asset/public/index.html", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("javascript:alert(1)", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isAllowedRetryNavigation("http://127.0.0.1:9999/", DEBUG_SERVER));

        assertFalse(OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                true, "https://m14u.pages.dev/", PROD_SERVER, false));
        assertTrue(OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                false, "https://m14u.pages.dev/", PROD_SERVER, false));
        assertTrue(OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                true, "https://evil.com/", PROD_SERVER, false));

        // While retry is in flight, same-origin SPA/server redirects are allowed, external origins stay blocked
        assertFalse(OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                true, "https://m14u.pages.dev/home", PROD_SERVER, true));
        assertTrue(OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                true, "https://evil.com/phish", PROD_SERVER, true));
    }

    @Test
    public void buildOfflinePageUrlEncodesValidatedTarget() {
        assertEquals(
                "file:///android_asset/public/offline.html?retry=https%3A%2F%2Fm14u.pages.dev",
                OfflineFallbackPolicy.buildOfflinePageUrl("https://m14u.pages.dev/", false));
        assertEquals(
                "file:///android_asset/public/offline.html?retry=http%3A%2F%2F127.0.0.1%3A5173&status=failed",
                OfflineFallbackPolicy.buildOfflinePageUrl("http://127.0.0.1:5173", true));
        assertEquals(
                "file:///android_asset/public/offline.html?status=failed",
                OfflineFallbackPolicy.buildOfflinePageUrl("https://user@m14u.pages.dev", true));
        assertNull(OfflineFallbackPolicy.sanitizeRetryTarget("javascript:alert(1)"));
    }

    @Test
    public void sameHostMismatchedPortOrUserinfoDetectedForOriginHardening() {
        assertTrue(OfflineFallbackPolicy.hasSameSchemeAndHost("http://127.0.0.1:8080/test", DEBUG_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("http://127.0.0.1:8080/test", DEBUG_SERVER));

        assertTrue(OfflineFallbackPolicy.hasSameSchemeAndHost("https://user@m14u.pages.dev/", PROD_SERVER));
        assertFalse(OfflineFallbackPolicy.isSameOrigin("https://user@m14u.pages.dev/", PROD_SERVER));

        assertFalse(OfflineFallbackPolicy.hasSameSchemeAndHost("https://youtube.com/watch?v=123", PROD_SERVER));
    }
}
