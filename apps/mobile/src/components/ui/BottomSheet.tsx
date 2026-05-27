import { forwardRef, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import GorhomBottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet"

import { SURFACE_COLOR, TEXT_SECONDARY } from "../../lib/color"

export type BottomSheetProps = {
  snapPoints: (string | number)[]
  children: ReactNode
  onChange?: (index: number) => void
}

export const BottomSheet = forwardRef<GorhomBottomSheet, BottomSheetProps>(
  function BottomSheet({ snapPoints, children, onChange }, ref) {
    const backgroundStyle = useMemo(
      () => ({
        backgroundColor: SURFACE_COLOR,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
      }),
      [],
    )

    const handleIndicatorStyle = useMemo(
      () => ({
        backgroundColor: TEXT_SECONDARY,
        width: 40,
      }),
      [],
    )

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          opacity={0.7}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          pressBehavior="close"
        />
      ),
      [],
    )

    return (
      <GorhomBottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableDynamicSizing={false}
        backgroundStyle={backgroundStyle}
        handleIndicatorStyle={handleIndicatorStyle}
        backdropComponent={renderBackdrop}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        onChange={onChange}
      >
        {children}
      </GorhomBottomSheet>
    )
  },
)
