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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
      </View>
    )
  }

  return (
    <ScrollContext.Provider value={scrollHandle}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={scrollHandle.handleScroll}
        scrollEventThrottle={16}
      >
        {state.data.sections.map((section, index) => (
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
