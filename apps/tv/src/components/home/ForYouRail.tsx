import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import {
  AppState,
  Dimensions,
  Text,
  View,
  StyleSheet,
  type View as NativeView,
} from "react-native"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"
import { scale } from "../../lib/scale"
import { HomeRail } from "./HomeRail"
import { ScreenStateView } from "../ScreenStateView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import {
  createImpressionTracker,
  visibleFraction,
} from "../../lib/recommendations/visibility"
import {
  fetchForYou,
  sendCardEvidence,
  selectRecommendation,
  subscribeRecommendations,
  getRecommendationGeneration,
  type Delivery,
} from "../../lib/recommendations/client"

export const FOR_YOU_SECTION: WatchHomeSection = {
  id: "recommended-for-you",
  eyebrow: "",
  title: "Recommended for you",
  description: null,
  layout: "rail",
  orientation: "horizontal",
  showSequenceNumbers: false,
  isPosterRail: false,
  cards: [],
}

function cardsFor(delivery: Delivery): WatchHomeCard[] {
  return [...delivery.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      id: item.id,
      sourceId: item.targetMediaId,
      coreId: item.targetMediaId,
      slug: item.videoSlug,
      title: item.videoTitle,
      description: item.description,
      label: "",
      rawLabel: null,
      metaLabel: null,
      imageUrl: item.imageUrl,
      landscapeImageUrl: item.imageUrl,
      imageAlt: item.videoTitle,
      muxPlaybackId: null,
      durationSeconds: item.durationSeconds,
      childCount: 0,
      parentCoreId: null,
      parentSlug: null,
      missingData: [],
    }))
}

type Props = Omit<
  React.ComponentProps<typeof HomeRail>,
  "eyebrow" | "title" | "cards" | "onCardPress"
> & {
  audioLanguageSlug: string
  visit: number
  visible: boolean
  onSelected: (slug: string) => void
}

export function ForYouRail({
  audioLanguageSlug,
  visit,
  visible,
  onSelected,
  ...railProps
}: Props) {
  const rowRef = useRef<NativeView | null>(null)
  const nodes = useRef(new Map<string, NativeView>())
  const [nearViewport, setNearViewport] = useState(false)
  const [revision, setRevision] = useState(0)
  const [slate, setSlate] = useState<{
    delivery: Delivery
    audio: string
    generation: number
  } | null>(null)
  const delivery =
    slate?.audio === audioLanguageSlug &&
    slate.generation === getRecommendationGeneration()
      ? slate.delivery
      : null
  const engaged = useRef(false)
  useEffect(() => {
    engaged.current = false
  }, [visit, audioLanguageSlug, revision])
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  )
  useEffect(
    () =>
      subscribeRecommendations(() => {
        setSlate(null)
        setRevision((r) => r + 1)
      }),
    [],
  )
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    )
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (!visible || !foreground) return
    const interval = setInterval(
      () =>
        rowRef.current?.measureInWindow((_x, y, _width, height) => {
          if (
            y < Dimensions.get("window").height + scale(320) &&
            y + height > 0
          )
            setNearViewport(true)
        }),
      500,
    )
    return () => clearInterval(interval)
  }, [visible, foreground])
  useEffect(() => {
    if (!nearViewport || !visible || !foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const generation = getRecommendationGeneration()
    setUnavailable(null)
    const load = async (retry: boolean) => {
      try {
        const result = await fetchForYou(audioLanguageSlug)
        if (cancelled || generation !== getRecommendationGeneration()) return
        if (
          result.result === "unavailable" &&
          retry &&
          (result.reason === "cooldown" || result.reason === "in_flight")
        ) {
          timer = setTimeout(() => {
            void load(false)
          }, 5000)
          return
        }
        if (result.result !== "unavailable" && result.items.length === 6) {
          setSlate((previous) =>
            engaged.current && previous?.audio === audioLanguageSlug
              ? previous
              : { delivery: result, audio: audioLanguageSlug, generation },
          )
          setUnavailable(null)
        } else {
          if (engaged.current) return
          setSlate(null)
          setUnavailable(
            result.reason === "coverage_unavailable"
              ? "Recommendations are unavailable for this audio language"
              : "Recommendations are temporarily unavailable",
          )
        }
      } catch {
        if (!cancelled) {
          if (engaged.current) return
          setSlate(null)
          setUnavailable("Recommendations are temporarily unavailable")
        }
      }
    }
    void load(true)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [nearViewport, visit, audioLanguageSlug, revision, visible, foreground])
  const cards = useMemo(() => (delivery ? cardsFor(delivery) : []), [delivery])
  const tracker = useMemo(createImpressionTracker, [delivery])
  const captureNode = useCallback(
    (card: WatchHomeCard, node: NativeView | null) => {
      if (node) nodes.current.set(card.id, node)
      else nodes.current.delete(card.id)
    },
    [],
  )
  useEffect(() => {
    if (!visible || !foreground || !delivery) {
      tracker.interrupt()
      return
    }
    let disposed = false
    const generation = getRecommendationGeneration()
    const interval = setInterval(() => {
      const screen = Dimensions.get("window")
      nodes.current.forEach((node, id) =>
        node.measureInWindow((x, y, width, height) => {
          if (disposed || generation !== getRecommendationGeneration()) return
          const fraction = visibleFraction(
            { x, y, width, height },
            {
              x: 0,
              y: scale(140),
              width: screen.width,
              height: screen.height - scale(140),
            },
          )
          if (!tracker.observe(id, fraction, true, performance.now())) return
          const item = delivery.items.find((candidate) => candidate.id === id)
          if (!item) return
          const attribution = {
            delivery,
            item,
            audioLanguageSlug,
            privacyGeneration: generation,
          }
          void sendCardEvidence(attribution).catch(() => {})
        }),
      )
    }, 250)
    return () => {
      disposed = true
      clearInterval(interval)
      tracker.interrupt()
    }
  }, [visible, foreground, delivery, tracker, audioLanguageSlug])
  const select = async (card: WatchHomeCard) => {
    if (!delivery || selecting) return
    const item = delivery.items.find((candidate) => candidate.id === card.id)
    if (!item) return
    setSelecting(true)
    try {
      onSelected(
        await selectRecommendation({
          delivery,
          item,
          audioLanguageSlug,
          privacyGeneration: slate?.generation ?? -1,
        }),
      )
    } catch {
      setUnavailable("Could not open this recommendation. Please retry.")
    } finally {
      setSelecting(false)
    }
  }
  return (
    <View ref={rowRef} collapsable={false} style={styles.row}>
      {delivery && !unavailable ? (
        <HomeRail
          {...railProps}
          eyebrow=""
          title="Recommended for you"
          cards={cards}
          onCardFocus={(card, node) => {
            engaged.current = true
            railProps.onCardFocus(card, node)
          }}
          onCardNode={captureNode}
          onCardPress={(card) => {
            void select(card)
          }}
        />
      ) : (
        <>
          <Text style={styles.title}>Recommended for you</Text>
          {unavailable ? (
            <ScreenStateView
              kind="error"
              message={unavailable}
              onRetry={() => setRevision((r) => r + 1)}
            />
          ) : (
            <Text style={styles.note}>Recommendations will appear here</Text>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: scale(350) },
  title: {
    color: WATCH_THEME.text,
    fontFamily: "System",
    fontSize: Math.round(scale(34)),
    fontWeight: "700",
    marginHorizontal: scale(80),
  },
  note: {
    color: WATCH_THEME.text66,
    fontSize: Math.round(scale(24)),
    margin: scale(80),
  },
})
