import { useEffect, useMemo } from "react"
import { ScrollView, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useQuery } from "@apollo/client/react"

import { GET_SERIES_BY_SLUG } from "../../src/lib/queries"
import { normalizeSeries } from "../../src/lib/normalizeVideo"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"
import { layout } from "../../src/styles/shared"

// Series detail screen — skeleton (U2): resolves the series, publishes it to the
// SeriesSessionProvider so the language sheet can read it. The hero (trailer or
// poster), metadata, description, and actions land in U3; the episode grid in
// U4. cache-first + returnPartialData mirrors the watch screen's payload posture.
export default function SeriesScreen() {
  const { slug } = useLocalSearchParams<{ slug: string; seed?: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""
  const { setSeries } = useSeriesSession()

  const { data } = useQuery(GET_SERIES_BY_SLUG, {
    variables: { slug: decodedSlug, locale: "en" },
    skip: !decodedSlug,
    fetchPolicy: "cache-first",
    returnPartialData: true,
  })

  const series = useMemo(
    // returnPartialData widens videoBySlug to a deep-partial type; normalizeSeries
    // tolerates missing fields (returns null without a documentId).
    () =>
      normalizeSeries(
        (data?.videoBySlug ?? null) as Parameters<typeof normalizeSeries>[0],
      ),
    [data],
  )

  useEffect(() => {
    setSeries(series)
  }, [series, setSeries])

  return (
    <View style={layout.screenContainer}>
      <ScrollView />
    </View>
  )
}
