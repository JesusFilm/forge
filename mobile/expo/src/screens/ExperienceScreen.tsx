import { useCallback, useRef } from "react"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "../components/sections"
import { SectionNavContext } from "../components/sections/SectionNavContext"
import { ScrollContext, useScrollHandle } from "../contexts/ScrollOffsetContext"
import { useExperience } from "../hooks/useExperience"
import type { RootStackParamList } from "../navigation/RootNavigator"

const DEFAULT_LOCALE = "en"

type Props = NativeStackScreenProps<RootStackParamList, "Experience">

export function ExperienceScreen({ route }: Props) {
  const { slug, locale = DEFAULT_LOCALE } = route.params
  const state = useExperience({ slug, locale })
  const scrollRef = useRef<ScrollView>(null)
  const sectionPositions = useRef<Map<string, number>>(new Map())
  const scrollHandle = useScrollHandle()

  const scrollToSection = useCallback((sectionKey: string) => {
    const y = sectionPositions.current.get(sectionKey)
    if (y != null && scrollRef.current) {
      scrollRef.current.scrollTo({ y, animated: true })
    }
  }, [])

  const registerSection = useCallback((sectionKey: string, y: number) => {
    sectionPositions.current.set(sectionKey, y)
  }, [])

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
    <SectionNavContext.Provider value={{ scrollToSection, registerSection }}>
      <ScrollContext.Provider value={scrollHandle}>
        {/* @ts-expect-error React 19 vs RN component types */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          onScroll={scrollHandle.handleScroll}
          scrollEventThrottle={16}
        >
          {state.data.sections.map((section, index) => {
            const key = `${section.id}-${index}`
            const sectionKey =
              "sectionKey" in section ? section.sectionKey : null
            return (
              // @ts-expect-error React 19 vs RN component types
              <View
                key={key}
                onLayout={
                  sectionKey
                    ? (e: LayoutChangeEvent) =>
                        registerSection(sectionKey, e.nativeEvent.layout.y)
                    : undefined
                }
              >
                <SectionDispatcher section={section} />
              </View>
            )
          })}
        </ScrollView>
      </ScrollContext.Provider>
    </SectionNavContext.Provider>
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
