import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "../components/sections"
import { ScrollContext, useScrollHandle } from "../contexts/ScrollOffsetContext"
import { useExperience } from "../hooks/useExperience"
import type { RootStackParamList } from "../navigation/RootNavigator"

const DEFAULT_LOCALE = "en"

type Props = NativeStackScreenProps<RootStackParamList, "Experience">

export function ExperienceScreen({ route }: Props) {
  const { slug, locale = DEFAULT_LOCALE } = route.params
  const state = useExperience({ slug, locale })
  const scrollHandle = useScrollHandle()

  if (state.status === "loading") {
    return (
      // @ts-expect-error React 19 vs RN component types
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  if (state.status === "error") {
    return (
      // @ts-expect-error React 19 vs RN component types
      <View style={styles.center}>
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.errorText}>{state.message}</Text>
      </View>
    )
  }

  return (
    <ScrollContext.Provider value={scrollHandle}>
      {/* @ts-expect-error React 19 vs RN component types */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={scrollHandle.handleScroll}
        scrollEventThrottle={16}
      >
        {state.data.sections.map((section, index) => (
          // @ts-expect-error React 19 vs RN component types
          <View key={`${section.id}-${index}`}>
            <SectionDispatcher section={section} />
          </View>
        ))}
      </ScrollView>
    </ScrollContext.Provider>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 14,
    color: "red",
    paddingHorizontal: 24,
    textAlign: "center",
  },
})
