package org.jesusfilm.layoutdirection

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class SaveFailedException :
  CodedException("ERR_LAYOUT_DIRECTION_SAVE", "The layout direction was not saved to disk", null)

class LayoutDirectionModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private fun applyToActivity(nativeMode: String) {
    val activity = appContext.currentActivity ?: return
    NativeDirection.apply(activity, nativeMode)
  }

  override fun definition() = ModuleDefinition {
    Name("LayoutDirection")

    Function("getState") {
      LayoutDirectionStore.state(context)
    }

    AsyncFunction("saveDirection") {
        isRTL: Boolean,
        nativeMode: String,
        reloadCount: Int,
        reloadKind: String?,
        reloadBundle: String? ->
      val saved = LayoutDirectionStore.saveDirection(
        context,
        isRTL,
        nativeMode,
        reloadCount,
        reloadKind,
        reloadBundle,
      )
      if (!saved) throw SaveFailedException()
      applyToActivity(nativeMode)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("saveNativeMode") { nativeMode: String ->
      if (!LayoutDirectionStore.saveNativeMode(context, nativeMode)) throw SaveFailedException()
      applyToActivity(nativeMode)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("applyNativeMode") { nativeMode: String ->
      applyToActivity(nativeMode)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("saveReportedFault") { fault: String ->
      if (!LayoutDirectionStore.saveReportedFault(context, fault)) throw SaveFailedException()
    }

    AsyncFunction("clearReloadRecord") {
      if (!LayoutDirectionStore.clearReloadRecord(context)) throw SaveFailedException()
    }
  }
}
