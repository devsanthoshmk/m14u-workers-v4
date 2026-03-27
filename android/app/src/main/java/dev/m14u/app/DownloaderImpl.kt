package dev.m14u.app

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request as NPRequest
import org.schabi.newpipe.extractor.downloader.Response
import java.util.concurrent.TimeUnit

class OkHttpDownloader : Downloader() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    override fun execute(request: NPRequest): Response {
        val url = request.url()
        val headers = request.headers()
        val dataToSend = request.dataToSend()

        val requestBuilder = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0")

        // Add headers
        for ((key, values) in headers) {
            for (value in values) {
                requestBuilder.addHeader(key, value)
            }
        }

        // Set method
        val httpMethod = request.httpMethod()
        when {
            httpMethod == "POST" || httpMethod == "PUT" -> {
                val body = dataToSend?.toRequestBody("application/json".toMediaType())
                    ?: "".toRequestBody()
                if (httpMethod == "POST") requestBuilder.post(body)
                else requestBuilder.put(body)
            }
            httpMethod == "GET" -> requestBuilder.get()
            httpMethod == "HEAD" -> requestBuilder.head()
            httpMethod == "DELETE" -> requestBuilder.delete()
        }

        val response = client.newCall(requestBuilder.build()).execute()

        val responseBody = response.body?.string()
        val responseHeaders = mutableMapOf<String, List<String>>()
        for (name in response.headers.names()) {
            responseHeaders[name] = response.headers.values(name)
        }

        return Response(
            response.code,
            response.message,
            responseHeaders,
            responseBody,
            response.request.url.toString()
        )
    }
}
