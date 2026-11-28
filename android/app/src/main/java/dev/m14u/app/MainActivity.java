package dev.m14u.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    @Override
    protected void load() {
        super.load();
        Bridge activeBridge = getBridge();
        if (activeBridge != null) {
            activeBridge.setWebViewClient(new OfflineBridgeWebViewClient(activeBridge));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(StreamExtractorPlugin.class);
        registerPlugin(NativePlaybackPlugin.class);
        registerPlugin(AppUpdater.class);
        super.onCreate(savedInstanceState);

        Bridge activeBridge = getBridge();
        if (activeBridge != null && !(activeBridge.getWebViewClient() instanceof OfflineBridgeWebViewClient)) {
            activeBridge.setWebViewClient(new OfflineBridgeWebViewClient(activeBridge));
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null
                        && !OfflineFallbackPolicy.isOfflineAssetUrl(webView.getUrl())
                        && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    // Background the task without finishing the activity or stopping playback.
                    moveTaskToBack(true);
                }
            }
        });

        // Draw behind the status bar (edge-to-edge)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
    }

    /**
     * Pure-JVM decision policy for main-frame offline fallback, origin allowlisting,
     * and loop prevention. Kept inside MainActivity for single-file ownership and direct unit testing.
     */
    public static final class OfflineFallbackPolicy {
        public static final String OFFLINE_ASSET_URL = "file:///android_asset/public/offline.html";
        private static final String OFFLINE_ASSET_PATH = "/android_asset/public/offline.html";
        // Chromium net::ERR_ABORTED maps to -3 (same numeric slot as ERROR_UNSUPPORTED_AUTH_SCHEME).
        public static final int ERROR_CODE_ABORTED = -3;

        private OfflineFallbackPolicy() {}

        private static final class RawUrlParts {
            final String scheme;
            final String authority;
            final String path;
            @Nullable final String rawQuery;

            RawUrlParts(String scheme, String authority, String path, @Nullable String rawQuery) {
                this.scheme = scheme;
                this.authority = authority;
                this.path = path;
                this.rawQuery = rawQuery;
            }
        }

        private static final class ParsedOrigin {
            final String scheme;
            final String host;
            final int port;
            final String path;
            @Nullable final String rawQuery;

            ParsedOrigin(String scheme, String host, int port, String path, @Nullable String rawQuery) {
                this.scheme = scheme;
                this.host = host;
                this.port = port;
                this.path = path;
                this.rawQuery = rawQuery;
            }

            boolean sameOrigin(ParsedOrigin other) {
                return scheme.equals(other.scheme)
                        && host.equals(other.host)
                        && port == other.port;
            }
        }

        private static boolean isValidSchemeToken(String scheme) {
            if (scheme.isEmpty()) return false;
            char first = scheme.charAt(0);
            if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'))) {
                return false;
            }
            for (int i = 1; i < scheme.length(); i++) {
                char ch = scheme.charAt(i);
                boolean valid = (ch >= 'a' && ch <= 'z')
                        || (ch >= 'A' && ch <= 'Z')
                        || (ch >= '0' && ch <= '9')
                        || ch == '+' || ch == '-' || ch == '.';
                if (!valid) return false;
            }
            return true;
        }

        private static boolean containsControlOrWhitespace(String text) {
            for (int i = 0; i < text.length(); i++) {
                char ch = text.charAt(i);
                if (ch <= 0x20 || ch == 0x7F) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Parses scheme, authority, path, and query permissively for query/fragment characters
         * (such as '|', '{', '}', '^', '[', ']') that android.net.Uri and Chromium allow
         * but java.net.URI rejects.
         */
        @Nullable
        private static RawUrlParts splitAuthorityUrl(@Nullable String rawUrl) {
            if (rawUrl == null) return null;
            String trimmed = rawUrl.trim();
            if (trimmed.isEmpty()) return null;

            int schemeDelimiter = trimmed.indexOf("://");
            if (schemeDelimiter <= 0) return null;

            String rawScheme = trimmed.substring(0, schemeDelimiter);
            if (!isValidSchemeToken(rawScheme)) return null;
            String lowerScheme = rawScheme.toLowerCase(Locale.ROOT);

            int authStart = schemeDelimiter + 3;
            int authEnd = trimmed.length();
            for (int i = authStart; i < trimmed.length(); i++) {
                char ch = trimmed.charAt(i);
                if (ch == '/' || ch == '?' || ch == '#') {
                    authEnd = i;
                    break;
                }
            }

            String authority = trimmed.substring(authStart, authEnd);
            String remainder = trimmed.substring(authEnd);

            int hashIndex = remainder.indexOf('#');
            String beforeHash = hashIndex >= 0 ? remainder.substring(0, hashIndex) : remainder;
            int queryIndex = beforeHash.indexOf('?');
            String rawPath = queryIndex >= 0 ? beforeHash.substring(0, queryIndex) : beforeHash;
            String rawQuery = queryIndex >= 0 ? beforeHash.substring(queryIndex + 1) : null;

            return new RawUrlParts(lowerScheme, authority, normalizePath(rawPath), rawQuery);
        }

        @Nullable
        private static String extractHostIgnoringUserInfo(String authority) {
            if (authority.isEmpty() || containsControlOrWhitespace(authority) || authority.indexOf('\\') >= 0) {
                return null;
            }
            int atIndex = authority.lastIndexOf('@');
            String hostPort = atIndex >= 0 ? authority.substring(atIndex + 1) : authority;
            if (hostPort.isEmpty()) return null;

            if (hostPort.startsWith("[")) {
                int closeBracket = hostPort.indexOf(']');
                if (closeBracket <= 1) return null;
                return hostPort.substring(0, closeBracket + 1).toLowerCase(Locale.ROOT);
            }

            int colon = hostPort.indexOf(':');
            String host = colon >= 0 ? hostPort.substring(0, colon) : hostPort;
            if (host.isEmpty()) return null;
            return host.toLowerCase(Locale.ROOT);
        }

        @Nullable
        private static ParsedOrigin parseHttpOrigin(@Nullable String rawUrl) {
            RawUrlParts parts = splitAuthorityUrl(rawUrl);
            if (parts == null) return null;

            if (!"http".equals(parts.scheme) && !"https".equals(parts.scheme)) {
                return null;
            }

            String authority = parts.authority;
            if (authority.isEmpty()
                    || containsControlOrWhitespace(authority)
                    || authority.indexOf('@') >= 0
                    || authority.indexOf('\\') >= 0) {
                return null;
            }

            String host;
            int port;
            if (authority.startsWith("[")) {
                int closeBracket = authority.indexOf(']');
                if (closeBracket <= 1) return null;
                host = authority.substring(0, closeBracket + 1).toLowerCase(Locale.ROOT);
                String rest = authority.substring(closeBracket + 1);
                if (rest.isEmpty()) {
                    port = "https".equals(parts.scheme) ? 443 : 80;
                } else {
                    if (rest.charAt(0) != ':') return null;
                    port = parsePort(rest.substring(1));
                    if (port == -1) return null;
                }
            } else {
                int firstColon = authority.indexOf(':');
                if (firstColon >= 0) {
                    if (authority.indexOf(':', firstColon + 1) >= 0) {
                        return null;
                    }
                    host = authority.substring(0, firstColon);
                    port = parsePort(authority.substring(firstColon + 1));
                    if (port == -1) return null;
                } else {
                    host = authority;
                    port = "https".equals(parts.scheme) ? 443 : 80;
                }
            }

            if (!isValidHost(host)) {
                return null;
            }

            return new ParsedOrigin(
                    parts.scheme,
                    host.toLowerCase(Locale.ROOT),
                    port,
                    parts.path,
                    parts.rawQuery
            );
        }

        private static int parsePort(String portStr) {
            if (portStr.isEmpty() || portStr.length() > 5) return -1;
            int value = 0;
            for (int i = 0; i < portStr.length(); i++) {
                char ch = portStr.charAt(i);
                if (ch < '0' || ch > '9') return -1;
                value = value * 10 + (ch - '0');
            }
            return (value >= 1 && value <= 65535) ? value : -1;
        }

        private static boolean isValidHost(String host) {
            if (host.isEmpty()) return false;
            if (host.startsWith("[") && host.endsWith("]")) {
                String inner = host.substring(1, host.length() - 1);
                if (inner.isEmpty()) return false;
                for (int i = 0; i < inner.length(); i++) {
                    char ch = inner.charAt(i);
                    boolean hexOrColon = (ch >= '0' && ch <= '9')
                            || (ch >= 'a' && ch <= 'f')
                            || (ch >= 'A' && ch <= 'F')
                            || ch == ':';
                    if (!hexOrColon) return false;
                }
                return inner.indexOf(':') >= 0;
            }
            if (host.startsWith(".") || host.endsWith(".") || host.contains("..")) {
                return false;
            }
            for (int i = 0; i < host.length(); i++) {
                char ch = host.charAt(i);
                boolean ok = (ch >= 'a' && ch <= 'z')
                        || (ch >= 'A' && ch <= 'Z')
                        || (ch >= '0' && ch <= '9')
                        || ch == '.' || ch == '-';
                if (!ok) return false;
            }
            return true;
        }

        private static String normalizePath(@Nullable String path) {
            if (path == null || path.isEmpty()) {
                return "/";
            }
            return path;
        }

        public static boolean isHttpOrHttps(@Nullable String rawUrl) {
            RawUrlParts parts = splitAuthorityUrl(rawUrl);
            return parts != null && ("http".equals(parts.scheme) || "https".equals(parts.scheme));
        }

        public static boolean hasDisallowedAuthority(@Nullable String rawUrl) {
            RawUrlParts parts = splitAuthorityUrl(rawUrl);
            if (parts == null) return false;
            if (!"http".equals(parts.scheme) && !"https".equals(parts.scheme)) return false;
            return parts.authority.isEmpty()
                    || parts.authority.indexOf('@') >= 0
                    || parts.authority.indexOf('\\') >= 0
                    || containsControlOrWhitespace(parts.authority);
        }

        public static boolean hasSameSchemeAndHost(@Nullable String candidateUrl, @Nullable String serverUrl) {
            RawUrlParts candidate = splitAuthorityUrl(candidateUrl);
            RawUrlParts server = splitAuthorityUrl(serverUrl);
            if (candidate == null || server == null) return false;
            if (!candidate.scheme.equals(server.scheme)) return false;

            String cHost = extractHostIgnoringUserInfo(candidate.authority);
            String sHost = extractHostIgnoringUserInfo(server.authority);
            return cHost != null && sHost != null && cHost.equals(sHost);
        }

        public static boolean isSameOrigin(@Nullable String candidateUrl, @Nullable String serverUrl) {
            ParsedOrigin candidate = parseHttpOrigin(candidateUrl);
            ParsedOrigin server = parseHttpOrigin(serverUrl);
            return candidate != null && server != null && candidate.sameOrigin(server);
        }

        public static boolean isOfflineAssetUrl(@Nullable String url) {
            RawUrlParts parts = splitAuthorityUrl(url);
            if (parts == null) return false;
            if (!"file".equals(parts.scheme)) return false;
            if (!parts.authority.isEmpty()) return false;
            return OFFLINE_ASSET_PATH.equals(parts.path);
        }

        public static boolean isAbortedOrNonOfflineError(
                int errorCode,
                @Nullable CharSequence errorDescription
        ) {
            String desc = errorDescription == null
                    ? ""
                    : errorDescription.toString().toUpperCase(Locale.ROOT);
            if (desc.contains("ERR_ABORTED")) {
                return true;
            }
            switch (errorCode) {
                case WebViewClient.ERROR_HOST_LOOKUP:
                case WebViewClient.ERROR_CONNECT:
                case WebViewClient.ERROR_IO:
                case WebViewClient.ERROR_TIMEOUT:
                    return false;
                case WebViewClient.ERROR_UNKNOWN:
                    return !isConnectivityErrorDescription(desc);
                case ERROR_CODE_ABORTED:
                default:
                    return true;
            }
        }

        private static boolean isConnectivityErrorDescription(String upperDesc) {
            if (upperDesc.isEmpty()) return false;
            return upperDesc.contains("ERR_INTERNET_DISCONNECTED")
                    || upperDesc.contains("ERR_NETWORK_CHANGED")
                    || upperDesc.contains("ERR_NAME_NOT_RESOLVED")
                    || upperDesc.contains("ERR_ADDRESS_UNREACHABLE")
                    || upperDesc.contains("ERR_CONNECTION_TIMED_OUT")
                    || upperDesc.contains("ERR_TIMED_OUT")
                    || upperDesc.contains("ERR_CONNECTION_REFUSED")
                    || upperDesc.contains("ERR_CONNECTION_RESET")
                    || upperDesc.contains("ERR_CONNECTION_FAILED")
                    || upperDesc.contains("ERR_CONNECTION_ABORTED")
                    || upperDesc.contains("ERR_NETWORK_ACCESS_DENIED");
        }

        public static boolean shouldShowOfflineFallback(
                boolean isForMainFrame,
                @Nullable String requestUrl,
                @Nullable String configuredServerUrl
        ) {
            return shouldShowOfflineFallback(
                    isForMainFrame,
                    requestUrl,
                    configuredServerUrl,
                    WebViewClient.ERROR_HOST_LOOKUP,
                    null
            );
        }

        public static boolean shouldShowOfflineFallback(
                boolean isForMainFrame,
                @Nullable String requestUrl,
                @Nullable String configuredServerUrl,
                int errorCode
        ) {
            return shouldShowOfflineFallback(
                    isForMainFrame,
                    requestUrl,
                    configuredServerUrl,
                    errorCode,
                    null
            );
        }

        public static boolean shouldShowOfflineFallback(
                boolean isForMainFrame,
                @Nullable String requestUrl,
                @Nullable String configuredServerUrl,
                int errorCode,
                @Nullable CharSequence errorDescription
        ) {
            if (!isForMainFrame) return false;
            if (isOfflineAssetUrl(requestUrl)) return false;
            if (!isSameOrigin(requestUrl, configuredServerUrl)) return false;
            return !isAbortedOrNonOfflineError(errorCode, errorDescription);
        }

        public static boolean shouldShowHttpErrorFallback(
                boolean isForMainFrame,
                int statusCode,
                @Nullable String requestUrl,
                @Nullable String configuredServerUrl
        ) {
            if (!isForMainFrame) return false;
            if (statusCode < 500 || statusCode > 599) return false;
            if (isOfflineAssetUrl(requestUrl)) return false;
            return isSameOrigin(requestUrl, configuredServerUrl);
        }

        public static boolean isAllowedRetryNavigation(
                @Nullable String targetUrl,
                @Nullable String configuredServerUrl
        ) {
            ParsedOrigin target = parseHttpOrigin(targetUrl);
            ParsedOrigin server = parseHttpOrigin(configuredServerUrl);
            if (target == null || server == null) return false;
            if (!target.sameOrigin(server)) return false;
            if (!target.path.equals(server.path)) return false;
            if (target.rawQuery == null) {
                return server.rawQuery == null;
            }
            return target.rawQuery.equals(server.rawQuery);
        }

        public static boolean shouldBlockNavigationFromOfflinePage(
                boolean isForMainFrame,
                @Nullable String targetUrl,
                @Nullable String configuredServerUrl,
                boolean retryInFlight
        ) {
            if (!isForMainFrame) {
                return true;
            }
            if (retryInFlight) {
                return !isSameOrigin(targetUrl, configuredServerUrl);
            }
            return !isAllowedRetryNavigation(targetUrl, configuredServerUrl);
        }

        @Nullable
        public static String sanitizeRetryTarget(@Nullable String serverUrl) {
            ParsedOrigin parsed = parseHttpOrigin(serverUrl);
            if (parsed == null) return null;

            boolean isDefaultPort = ("https".equals(parsed.scheme) && parsed.port == 443)
                    || ("http".equals(parsed.scheme) && parsed.port == 80);
            StringBuilder sb = new StringBuilder();
            sb.append(parsed.scheme).append("://").append(parsed.host);
            if (!isDefaultPort) {
                sb.append(':').append(parsed.port);
            }
            if (!"/".equals(parsed.path)) {
                sb.append(parsed.path);
            }
            if (parsed.rawQuery != null && !parsed.rawQuery.isEmpty()) {
                sb.append('?').append(parsed.rawQuery);
            }
            return sb.toString();
        }

        public static String buildOfflinePageUrl(@Nullable String serverUrl, boolean retryFailed) {
            String safeTarget = sanitizeRetryTarget(serverUrl);
            StringBuilder sb = new StringBuilder(OFFLINE_ASSET_URL);
            char separator = '?';
            if (safeTarget != null) {
                try {
                    sb.append(separator)
                            .append("retry=")
                            .append(URLEncoder.encode(safeTarget, StandardCharsets.UTF_8.name()));
                    separator = '&';
                } catch (UnsupportedEncodingException ignored) {
                    // UTF-8 is always supported on Android and the JVM.
                }
            }
            if (retryFailed) {
                sb.append(separator).append("status=failed");
            }
            return sb.toString();
        }
    }

    private static final class OfflineBridgeWebViewClient extends BridgeWebViewClient {
        @Nullable
        private final String configuredServerUrl;
        private boolean fallbackLoading = false;
        private boolean mainFrameFailed = false;
        private boolean retryInFlight = false;
        private boolean pendingClearHistoryOnRecovery = false;

        OfflineBridgeWebViewClient(Bridge bridge) {
            super(bridge);
            String serverUrl = bridge.getServerUrl();
            this.configuredServerUrl = serverUrl != null ? serverUrl : bridge.getAppUrl();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) {
                return true;
            }

            Uri targetUri = request.getUrl();
            String targetUrl = targetUri.toString();
            String currentUrl = view == null ? null : view.getUrl();

            if (OfflineFallbackPolicy.isOfflineAssetUrl(currentUrl)) {
                boolean block = OfflineFallbackPolicy.shouldBlockNavigationFromOfflinePage(
                        request.isForMainFrame(),
                        targetUrl,
                        configuredServerUrl,
                        retryInFlight
                );
                if (block) {
                    if (request.isForMainFrame()) {
                        retryInFlight = false;
                    }
                } else {
                    retryInFlight = true;
                    fallbackLoading = false;
                    mainFrameFailed = false;
                    pendingClearHistoryOnRecovery = true;
                }
                return block;
            }

            if (OfflineFallbackPolicy.isHttpOrHttps(targetUrl)) {
                boolean hasDisallowedAuthority = targetUri.getUserInfo() != null
                        || targetUri.getEncodedUserInfo() != null
                        || OfflineFallbackPolicy.hasDisallowedAuthority(targetUrl);
                if (hasDisallowedAuthority) {
                    return true;
                }
                if (OfflineFallbackPolicy.hasSameSchemeAndHost(targetUrl, configuredServerUrl)
                        && !OfflineFallbackPolicy.isSameOrigin(targetUrl, configuredServerUrl)) {
                    // Reject port mismatches on the configured host before Bridge.launchIntent.
                    return true;
                }
            }

            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if (!OfflineFallbackPolicy.isOfflineAssetUrl(url)) {
                fallbackLoading = false;
                mainFrameFailed = false;
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (OfflineFallbackPolicy.isOfflineAssetUrl(url)) {
                fallbackLoading = false;
                mainFrameFailed = false;
                retryInFlight = false;
                return;
            }

            if (view != null
                    && view.getProgress() == 100
                    && !mainFrameFailed
                    && !fallbackLoading
                    && OfflineFallbackPolicy.isSameOrigin(url, configuredServerUrl)) {
                retryInFlight = false;
                if (pendingClearHistoryOnRecovery) {
                    view.clearHistory();
                    pendingClearHistoryOnRecovery = false;
                }
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (view == null || request == null || request.getUrl() == null || error == null) {
                return;
            }

            String requestUrl = request.getUrl().toString();
            if (!OfflineFallbackPolicy.shouldShowOfflineFallback(
                    request.isForMainFrame(),
                    requestUrl,
                    configuredServerUrl,
                    error.getErrorCode(),
                    error.getDescription())) {
                return;
            }

            triggerOfflineFallback(view);
        }

        @Override
        public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse errorResponse
        ) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (view == null || request == null || request.getUrl() == null || errorResponse == null) {
                return;
            }

            String requestUrl = request.getUrl().toString();
            if (!OfflineFallbackPolicy.shouldShowHttpErrorFallback(
                    request.isForMainFrame(),
                    errorResponse.getStatusCode(),
                    requestUrl,
                    configuredServerUrl)) {
                return;
            }

            triggerOfflineFallback(view);
        }

        private void triggerOfflineFallback(WebView view) {
            if (fallbackLoading) {
                return;
            }
            boolean wasRetryAttempt = retryInFlight;
            mainFrameFailed = true;
            fallbackLoading = true;
            retryInFlight = false;
            pendingClearHistoryOnRecovery = true;
            view.loadUrl(OfflineFallbackPolicy.buildOfflinePageUrl(configuredServerUrl, wasRetryAttempt));
        }
    }
}
