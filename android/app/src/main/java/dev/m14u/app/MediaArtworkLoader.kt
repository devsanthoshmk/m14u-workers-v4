package dev.m14u.app

import android.graphics.Bitmap
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import java.io.IOException

@OptIn(UnstableApi::class)
internal class MediaArtworkLoader(private val delegate: BitmapLoader) : BitmapLoader {
    companion object { const val SCHEME = "m14u-artwork" }

    override fun supportsMimeType(mimeType: String) = delegate.supportsMimeType(mimeType)
    override fun decodeBitmap(data: ByteArray) = delegate.decodeBitmap(data)

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> {
        if (uri.scheme != SCHEME) return delegate.loadBitmap(uri)
        val candidates = uri.getQueryParameters("url").map(Uri::parse).filter { it.scheme == "https" }
        fun load(index: Int): ListenableFuture<Bitmap> {
            if (index == candidates.size) return Futures.immediateFailedFuture(IOException("No track artwork available"))
            return Futures.catchingAsync(delegate.loadBitmap(candidates[index]), Exception::class.java,
                { load(index + 1) }, MoreExecutors.directExecutor())
        }
        return load(0)
    }
}
