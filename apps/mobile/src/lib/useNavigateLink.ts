import { useCallback } from "react"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import type { RootStackParamList } from "../navigation/RootNavigator"
import { navigateLink } from "./navigateLink"

/**
 * Hook that returns a function to handle link presses.
 * Internal links navigate within the app; external links open in browser.
 */
export function useNavigateLink(): (url: string) => void {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  return useCallback(
    (url: string) => {
      navigateLink(url, (screen, params) =>
        navigation.navigate(
          screen as keyof RootStackParamList,
          params as RootStackParamList[keyof RootStackParamList],
        ),
      )
    },
    [navigation],
  )
}
