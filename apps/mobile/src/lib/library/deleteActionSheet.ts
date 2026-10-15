// The iOS 26 Downloads delete confirmation (feat-705 U12, KTD8): the native
// action sheet in place of `DeleteConfirmSheet`. Android and iOS before 26
// keep the card, which reports through its tap names.
import { ActionSheetIOS } from "react-native"

import { getT } from "../../i18n/useT"
import { iosSheetOptions, type MenuAction } from "../actionMenu"
import { reportDatadogAction } from "../datadog"
import { formatLibraryBytes } from "../libraryDownloads"
import { getNonRouteSheetCounter } from "../miniPlayer/suppression"

export type DeleteSelection = {
  /** The selected download slugs. The sheet copies them when it opens. */
  slugs: Iterable<string>
  /** The bytes the delete frees, for the message. */
  combinedBytes: number
}

export type DeleteActionSheet = {
  /** Shows the sheet unless one is open. Delete passes the slugs from open. */
  present: (
    selection: DeleteSelection,
    onDelete: (slugs: readonly string[]) => void | Promise<void>,
  ) => void
  /** Closes an open sheet with no report, because selection ended under it. */
  dismiss: () => void
}

const SHEET_ID = "libraryDeleteActionSheet"

/** One per screen. Call `present` from the Delete press, never an effect. */
export function createDeleteActionSheet(): DeleteActionSheet {
  let openToken: object | null = null

  function release() {
    openToken = null
    getNonRouteSheetCounter().close(SHEET_ID)
  }

  return {
    present(selection, onDelete) {
      if (openToken != null) return
      const slugs = Array.from(selection.slugs)
      const t = getT("Library")
      const actions: MenuAction[] = [
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => {
            reportDatadogAction("library-delete-confirm")
            void onDelete(slugs)
          },
        },
        {
          text: t("cancel"),
          style: "cancel",
          onPress: () => reportDatadogAction("library-delete-cancel"),
        },
      ]
      const token = {}
      openToken = token
      getNonRouteSheetCounter().open(SHEET_ID)
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("deleteTitle", { count: slugs.length }),
          message: t("deleteBody", {
            size: formatLibraryBytes(selection.combinedBytes),
          }),
          // A cancel index makes a tap outside the sheet a Cancel (R17).
          ...iosSheetOptions(actions),
          userInterfaceStyle: "dark",
        },
        (index) => {
          // A sheet that `dismiss` closed may still answer; it reports nothing.
          if (openToken !== token) return
          release()
          actions[index]?.onPress?.()
        },
      )
    },
    dismiss() {
      if (openToken == null) return
      release()
      ActionSheetIOS.dismissActionSheet()
    },
  }
}
