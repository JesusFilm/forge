import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { apolloClient } from "./src/lib/apolloClient"
import { getWatchHome } from "./src/lib/experienceService"

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
    getWatchHome(apolloClient, "en")
      .then((result) => {
        if (!isMounted) return
        if (result.error) {
          setQueryStatus({
            status: "error",
            message:
              result.error instanceof Error
                ? result.error.message
                : result.error.message,
          })
        } else {
          setQueryStatus({ status: "success", slug: result.data.slug ?? null })
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

  const statusMessage = (() => {
    if (queryStatus.status === "loading") return "Loading GraphQL..."
    if (queryStatus.status === "error")
      return `GraphQL error: ${queryStatus.message}`
    return queryStatus.slug
      ? `GraphQL connected. Homepage: ${queryStatus.slug}`
      : "GraphQL connected. No homepage experience."
  })()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Apollo GraphQL test</Text>
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
