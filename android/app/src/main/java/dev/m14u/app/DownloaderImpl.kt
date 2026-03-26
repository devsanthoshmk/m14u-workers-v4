package dev.m14u.app

import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class DownloaderImpl private constructor() : Downloader() {

    companion object {
        private val instance = DownloaderImpl()
        fun getInstance(): DownloaderImpl = instance
    }

    override fun execute(request: Request): Response {
        val url = URL(request.url())
        val connection = url.openConnection() as HttpURLConnection

        connection.requestMethod = request.httpMethod()
        connection.connectTimeout = 30000
        connection.readTimeout = 30000

        for ((key, values) in request.headers()) {
            for (value in values) {
                connection.addRequestProperty(key, value)
            }
        }

        val dataToSend = request.dataToSend()
        if (dataToSend != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(dataToSend) }
        }

        val responseCode = connection.responseCode
        val responseMessage = connection.responseMessage
        val responseHeaders = connection.headerFields
            .filterKeys { it != null }
            .mapValues { it.value }

        val responseBody = try {
            connection.inputStream.bufferedReader().readText()
        } catch (e: IOException) {
            connection.errorStream?.bufferedReader()?.readText() ?: ""
        }

        return Response(responseCode, responseMessage, responseHeaders, responseBody, request.url())
    }
}
