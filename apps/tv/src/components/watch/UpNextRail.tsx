// Up Next rail for the video-details screen. Sibling videos under the same
// parent; selecting a card opens THAT video's details screen (R15) — it does
// NOT start playback. Renders nothing when there are no siblings (the inverted
// admin relation yields an empty list on current main; the rail stays
// empty-but-stable until that fix lands — KTD5).

import { StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import type { WatchSibling } from "../../lib/normalizeVideo"
import { ContentRail, type ContentRailItemHooks } from "../ContentRail"
import { FocusableCard } from "../FocusableCard"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"

const CARD_WIDTH = scale(340)
const CARD_HEIGHT = scale(191) // 16:9

export function UpNextRail({ siblings }: { siblings: WatchSibling[] }) {
  const router = useRouter()

  if (siblings.length === 0) return null

  return (
    <ContentRail
      title="Up Next"
      railId="up-next"
      data={siblings}
      keyExtractor={(item) => item.documentId}
      renderItem={(item, _index, hooks: ContentRailItemHooks) => (
        <SiblingCard
          sibling={item}
          onFocus={hooks.onFocus}
          onPress={() => router.push(`/watch/${encodeURIComponent(item.slug)}`)}
        />
      )}
    />
  )
}

function SiblingCard({
  sibling,
  onPress,
  onFocus,
}: {
  sibling: WatchSibling
  onPress: () => void
  onFocus: () => void
}) {
  const title = sibling.title ?? sibling.slug
  return (
    <FocusableCard
      onPress={onPress}
      onFocus={onFocus}
      style={styles.card}
      accessibilityLabel={title}
      accessibilityHint="Opens this video"
    >
      {sibling.posterUrl != null ? (
        <Image
          source={{ uri: sibling.posterUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`upnext-${sibling.documentId}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
      )}
      <View style={styles.labelWrap}>
        <Text style={styles.label} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </FocusableCard>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: COLORS.surfaceContainer,
  },
  posterFallback: {
    backgroundColor: COLORS.surfaceContainerHigh,
  },
  labelWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    padding: scale(16),
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  label: {
    fontFamily: "System",
    fontSize: scale(18),
    fontWeight: "600",
    color: COLORS.text,
  },
})
