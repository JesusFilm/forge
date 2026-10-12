import { requireOptionalNativeModule } from "expo-modules-core"

type Bridge = {
  writeSnapshot: (json: string) => Promise<boolean>
  clearSnapshot: () => Promise<void>
}
export const topShelf = requireOptionalNativeModule<Bridge>("TopShelf")
