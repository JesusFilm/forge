declare module "@expo/vector-icons/Ionicons" {
  import type { ComponentType } from "react"
  import type { TextStyle, ViewStyle } from "react-native"

  interface IconProps {
    name: string
    size?: number
    color?: string
    style?: TextStyle | ViewStyle
  }

  const Ionicons: ComponentType<IconProps>
  export default Ionicons
}
