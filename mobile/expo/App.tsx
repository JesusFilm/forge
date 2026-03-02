import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { GET_WATCH_EXPERIENCE } from "@forge/graphql"
import { apolloClient } from "./src/lib/apolloClient"

type QueryStatus =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; slug: string | null }

export default function App() {
  const [queryStatus, setQueryStatus] = useState<QueryStatus>({
    status: "loading",
  })

  useEffect(() => {
    let isMounted = true
    apolloClient
      .query({
        query: GET_WATCH_EXPERIENCE,
        variables: {
          locale: "en",
          filters: { isHomepage: { eq: true } },
        },
      })
      .then((result) => {
        if (!isMounted) return
        const experiences = result.data?.experiences
        const slug = experiences?.[0]?.slug ?? null
        setQueryStatus({ status: "success", slug })
      })
      .catch((err: Error) => {
        if (!isMounted) return
        setQueryStatus({ status: "error", message: err.message })
      })
    return () => {
      isMounted = false
    }
  }, [])

  const statusMessage = (() => {
    if (queryStatus.status === "loading") return "Loading GraphQL..."
    if (queryStatus.status === "error")
      return `GraphQL error: ${queryStatus.message}`
    return queryStatus.slug
      ? `GraphQL connected. Homepage: ${queryStatus.slug}`
      : "GraphQL connected. No homepage experience."
  })()

  return (
    // @ts-expect-error React 19 ReactNode (includes bigint) vs RN component types; known Expo/RN 0.81 mismatch
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.title}>Apollo GraphQL test</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.status}>{statusMessage}</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    textAlign: "center",
  },
})
