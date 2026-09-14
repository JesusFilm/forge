package expo.modules.nativeandroidplayer

import android.content.Context
import android.graphics.Canvas

internal class NativePlayerIcon(context: Context, resource: Int) {
  private val drawable = requireNotNull(context.getDrawable(resource)).mutate()

  fun draw(canvas: Canvas, x: Float, y: Float, size: Float, color: Int) {
    drawable.setTint(color)
    drawable.setBounds((x - size / 2).toInt(), (y - size / 2).toInt(),
      (x + size / 2).toInt(), (y + size / 2).toInt())
    drawable.draw(canvas)
  }
}
