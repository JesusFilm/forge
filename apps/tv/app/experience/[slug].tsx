import { useLocalSearchParams } from "expo-router"

import { ExperienceRenderer } from "../../src/components/ExperienceRenderer"

export default function ExperienceDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = decodeURIComponent(slug ?? "")

  return <ExperienceRenderer slug={decodedSlug} />
}
