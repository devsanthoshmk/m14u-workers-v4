package dev.m14u.app

import androidx.javascriptengine.DataInputException
import androidx.javascriptengine.EvaluationFailedException
import androidx.javascriptengine.IsolateTerminatedException
import androidx.javascriptengine.MemoryLimitExceededException
import androidx.javascriptengine.SandboxDeadException
import androidx.javascriptengine.SandboxUnsupportedException
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException

class ResolverEngineTest {
    @Test fun classifiesEmptyResultCauses() {
        assertEquals(
            ResolveOutcome.TransientFailure("network_io_error"),
            classifyEmptyResult(sawDisallowedRequest = false, sawNetworkIoFailure = true, sawUpstreamHttpFailure = false),
        )
        assertEquals(
            ResolveOutcome.TransientFailure("upstream_http_error"),
            classifyEmptyResult(sawDisallowedRequest = false, sawNetworkIoFailure = false, sawUpstreamHttpFailure = true),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("disallowed_broker_request"),
            classifyEmptyResult(sawDisallowedRequest = true, sawNetworkIoFailure = true, sawUpstreamHttpFailure = true),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("empty_result"),
            classifyEmptyResult(sawDisallowedRequest = false, sawNetworkIoFailure = false, sawUpstreamHttpFailure = false),
        )
    }

    @Test fun classifiesExecutionExceptions() {
        assertEquals(
            ResolveOutcome.TransientFailure("engine_closed"),
            classifyExecutionException(SandboxDeadException("closed"), engineClosed = true),
        )
        assertEquals(
            ResolveOutcome.TransientFailure("timeout"),
            classifyExecutionException(TimeoutException("deadline"), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.TransientFailure("interrupted"),
            classifyExecutionException(ExecutionException(InterruptedException("stop")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.TransientFailure("sandbox_unsupported"),
            classifyExecutionException(ExecutionException(SandboxUnsupportedException("no")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("js_exception"),
            classifyExecutionException(ExecutionException(EvaluationFailedException("ReferenceError")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("isolate_memory_limit"),
            classifyExecutionException(ExecutionException(MemoryLimitExceededException("oom")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("isolate_crashed"),
            classifyExecutionException(ExecutionException(IsolateTerminatedException("dead")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("isolate_crashed"),
            classifyExecutionException(ExecutionException(SandboxDeadException("dead")), engineClosed = false),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("invalid_js_input"),
            classifyExecutionException(ExecutionException(DataInputException("bad utf8")), engineClosed = false),
        )
    }

    @Test fun validatesResolverOutputJson() {
        assertTrue(
            isValidResolverOutputJson(
                """{"title":"Song","adaptiveFormats":[{"url":"https://rr1.googlevideo.com/videoplayback?itag=140","type":"audio/mp4; codecs=\"mp4a.40.2\"","bitrate":"131000"}]}""",
            ),
        )
        assertFalse(isValidResolverOutputJson("""{"title":"Song","adaptiveFormats":[]}"""))
        assertFalse(
            isValidResolverOutputJson(
                """{"adaptiveFormats":[{"url":"http://rr1.googlevideo.com/videoplayback","type":"audio/mp4"}]}""",
            ),
        )
        assertFalse(
            isValidResolverOutputJson(
                """{"adaptiveFormats":[{"url":"https://evil.example/audio","type":"audio/mp4"}]}""",
            ),
        )
        assertFalse(
            isValidResolverOutputJson(
                """{"adaptiveFormats":[{"url":"https://rr1.googlevideo.com/video","type":"video/mp4"}]}""",
            ),
        )
        assertFalse(isValidResolverOutputJson("not json"))
    }

    @Test fun resetsSandboxOnlyWhenAppropriate() {
        assertFalse(shouldResetSandbox(ResolveOutcome.TransientFailure("network_io_error"), engineClosed = false))
        assertFalse(shouldResetSandbox(ResolveOutcome.TransientFailure("upstream_http_error"), engineClosed = false))
        assertFalse(shouldResetSandbox(ResolveOutcome.TransientFailure("sandbox_unsupported"), engineClosed = false))
        assertTrue(shouldResetSandbox(ResolveOutcome.TransientFailure("timeout"), engineClosed = false))
        assertTrue(shouldResetSandbox(ResolveOutcome.CandidateFault("js_exception"), engineClosed = false))
        assertTrue(shouldResetSandbox(ResolveOutcome.TransientFailure("network_io_error"), engineClosed = true))
    }

    @Test fun classifiesUpstreamAnomaliesAsTransientNotCandidateFault() {
        val allowed = setOf("application/json", "application/javascript", "text/javascript")
        validateUpstreamResponse(200, "application/json", 128L, 4096, allowed)
        assertThrows(BrokerTransientException::class.java) {
            validateUpstreamResponse(302, "application/json", 0L, 4096, allowed)
        }
        assertThrows(BrokerTransientException::class.java) {
            validateUpstreamResponse(200, "text/html", 512L, 4096, allowed)
        }
        assertThrows(BrokerTransientException::class.java) {
            validateUpstreamResponse(200, "application/json", 4097L, 4096, allowed)
        }
        assertThrows(BrokerTransientException::class.java) {
            readBoundedUpstream(ByteArray(17) { 1 }.inputStream(), 16)
        }

        // BrokerTransientException (redirect/captive-portal/oversize) -> TransientFailure;
        // IllegalArgumentException (JS policy violation) -> CandidateFault.
        assertEquals(
            ResolveOutcome.TransientFailure("upstream_http_error"),
            classifyEmptyResult(sawDisallowedRequest = false, sawNetworkIoFailure = false, sawUpstreamHttpFailure = true),
        )
        assertEquals(
            ResolveOutcome.CandidateFault("disallowed_broker_request"),
            classifyEmptyResult(sawDisallowedRequest = true, sawNetworkIoFailure = false, sawUpstreamHttpFailure = false),
        )
    }
}
