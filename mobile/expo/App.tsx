import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { apolloClient } from "./src/lib/apolloClient"
import {
  getExperienceBySlug,
  type MappedExperience,
} from "./src/lib/experienceService"

type QueryStatus =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: MappedExperience }

export default function App() {
  const [queryStatus, setQueryStatus] = useState<QueryStatus>({
    status: "loading",
  })

  useEffect(() => {
    let isMounted = true
    getExperienceBySlug(apolloClient, "easter", "en")
      .then((result) => {
        if (!isMounted) return
        if (result.error) {
          setQueryStatus({ status: "error", message: result.error.message })
        } else if (!result.data) {
          setQueryStatus({ status: "error", message: "No data returned" })
        } else {
          setQueryStatus({ status: "success", data: result.data })
        }
      })
      .catch((err: Error) => {
        if (!isMounted) return
        setQueryStatus({ status: "error", message: err.message })
      })
    return () => {
      isMounted = false
    }
  }, [])

  return (
    // @ts-expect-error React 19 vs RN component types; known Expo/RN 0.81 mismatch
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.contentContainer}
    >
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.title}>E2E Verification</Text>

      {queryStatus.status === "loading" && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.status}>Loading easter experience…</Text>
      )}

      {queryStatus.status === "error" && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.error}>{queryStatus.message}</Text>
      )}

      {queryStatus.status === "success" && (
        // @ts-expect-error React 19 vs RN component types
        <View>
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.status}>
            slug: {queryStatus.data.slug} · sections:{" "}
            {queryStatus.data.sections.length}
          </Text>
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.json}>
            {JSON.stringify(queryStatus.data.sections, null, 2)}
          </Text>
        </View>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  contentContainer: {
    padding: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    marginBottom: 12,
  },
  error: {
    fontSize: 14,
    color: "red",
  },
  json: {
    fontSize: 11,
    fontFamily: "monospace",
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 8,
  },
})
