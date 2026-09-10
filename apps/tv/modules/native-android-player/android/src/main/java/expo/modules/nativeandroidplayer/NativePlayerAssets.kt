package expo.modules.nativeandroidplayer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.Future

internal class NativePlayerAssets {
  private class Request {
    @Volatile var connection: HttpURLConnection? = null
    @Volatile var cancelled = false
    fun cancel() { cancelled = true; connection?.disconnect() }
  }
  private val executor = Executors.newFixedThreadPool(2)
  private val handler = Handler(Looper.getMainLooper())
  private var subtitleTask: Future<*>? = null
  private var storyboardTask: Future<*>? = null
  private var subtitleRequest: Request? = null
  private var storyboardRequest: Request? = null
  private var subtitleGeneration = 0
  private var storyboardGeneration = 0
  private var closed = false
  private var storyboard: NativeStoryboard? = null
  private var sprite: Bitmap? = null
  private var sampleSize = 1
  private val frames = object : LinkedHashMap<Int, Bitmap>(8, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Bitmap>?): Boolean = size > 8
  }

  fun subtitles(url: String?, onLoaded: (List<NativeSubtitleCue>, Boolean) -> Unit) {
    val generation = ++subtitleGeneration
    subtitleRequest?.cancel()
    subtitleTask?.cancel(true)
    if (url == null) return
    val request = Request().also { subtitleRequest = it }
    subtitleTask = executor.submit {
      val cues = runCatching { NativeVttParser.parse(String(fetch(request, url, 2_000_000, 8_000), Charsets.UTF_8)) }
      handler.post {
        if (!closed && generation == subtitleGeneration) onLoaded(cues.getOrDefault(emptyList()), cues.isFailure)
      }
    }
  }

  fun storyboard(url: String?, onLoaded: () -> Unit) {
    val generation = ++storyboardGeneration
    storyboardRequest?.cancel()
    storyboardTask?.cancel(true)
    frames.clear()
    sprite = null
    storyboard = null
    if (url == null || !isMuxImage(url)) return
    val request = Request().also { storyboardRequest = it }
    storyboardTask = executor.submit {
      val result = runCatching {
        val json = JSONObject(String(fetch(request, url, 1_000_000, 8_000), Charsets.UTF_8))
        val width = json.getInt("tile_width")
        val height = json.getInt("tile_height")
        val duration = json.getDouble("duration")
        val imageUrl = json.getString("url")
        val rawTiles = json.getJSONArray("tiles")
        require(width in 1..4096 && height in 1..4096 && duration.isFinite() && duration > 0)
        require(rawTiles.length() in 1..500 && isMuxImage(imageUrl))
        val tiles = (0 until rawTiles.length()).map { index ->
          val tile = rawTiles.getJSONObject(index)
          NativeStoryboardTile(tile.getDouble("start"), tile.getInt("x"), tile.getInt("y")).also {
            require(it.start.isFinite() && it.start >= 0 && it.x in 0..32768 && it.y in 0..32768)
          }
        }.sortedBy { it.start }
        val metadata = NativeStoryboard(duration, width, height, tiles, imageUrl)
        val bytes = fetch(request, imageUrl, 15_000_000, 12_000)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0)
        require(tiles.all { it.x.toLong() + width <= bounds.outWidth && it.y.toLong() + height <= bounds.outHeight })
        var sample = 1
        while (bounds.outWidth.toLong() * bounds.outHeight * 4 / sample / sample > 16_000_000) sample *= 2
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
          BitmapFactory.Options().apply { inSampleSize = sample }))
        Triple(metadata, bitmap, sample)
      }.getOrNull()
      handler.post {
        if (!closed && generation == storyboardGeneration && result != null) {
          storyboard = result.first
          sprite = result.second
          sampleSize = result.third
          onLoaded()
        }
      }
    }
  }

  fun frame(position: Double): Bitmap? {
    val metadata = storyboard ?: return null
    val image = sprite ?: return null
    val index = metadata.tileIndex(position)
    frames[index]?.let { return it }
    val tile = metadata.tiles[index]
    val x = tile.x / sampleSize
    val y = tile.y / sampleSize
    val width = minOf(maxOf(1, metadata.tileWidth / sampleSize), image.width - x)
    val height = minOf(maxOf(1, metadata.tileHeight / sampleSize), image.height - y)
    if (width <= 0 || height <= 0) return null
    val tileImage = Bitmap.createBitmap(image, x, y, width, height)
    val scale = minOf(1f, 320f / width, 180f / height)
    return Bitmap.createScaledBitmap(tileImage, maxOf(1, (width * scale).toInt()),
      maxOf(1, (height * scale).toInt()), true).also { frames[index] = it }
  }

  fun close() {
    closed = true
    subtitleGeneration++
    storyboardGeneration++
    subtitleRequest?.cancel()
    storyboardRequest?.cancel()
    subtitleTask?.cancel(true)
    storyboardTask?.cancel(true)
    executor.shutdownNow()
    handler.removeCallbacksAndMessages(null)
    frames.clear()
    sprite = null
    storyboard = null
  }

  private fun isMuxImage(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme == "https" && uri.host == "image.mux.com" && uri.userInfo == null
  }.getOrDefault(false)

  private fun fetch(request: Request, value: String, limit: Int, timeout: Int): ByteArray {
    check(!request.cancelled)
    val url = URI(value).toURL()
    require(url.protocol == "https")
    val connection = url.openConnection() as HttpURLConnection
    request.connection = connection
    val deadline = System.nanoTime() + timeout * 1_000_000L
    try {
      check(!request.cancelled)
      connection.connectTimeout = timeout
      connection.readTimeout = timeout
      connection.instanceFollowRedirects = false
      require(connection.responseCode in 200..299)
      require(connection.contentLengthLong <= limit)
      return connection.inputStream.use { input ->
        val result = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
          if (request.cancelled || Thread.currentThread().isInterrupted) throw InterruptedException()
          val remaining = (deadline - System.nanoTime()) / 1_000_000
          check(remaining > 0)
          connection.readTimeout = minOf(timeout.toLong(), remaining).toInt().coerceAtLeast(1)
          val count = input.read(buffer)
          if (count < 0) break
          require(result.size() + count <= limit)
          result.write(buffer, 0, count)
        }
        result.toByteArray()
      }
    } finally {
      connection.disconnect()
      request.connection = null
    }
  }
}
