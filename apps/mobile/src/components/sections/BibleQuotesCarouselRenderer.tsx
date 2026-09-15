import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  FlatList,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { layout, text, button, card, carousel } from "../../styles/shared"
import {
  CARD_CONTENT_PADDING,
  COPYRIGHT_MAX_LINES,
  LINK_MARGIN_TOP,
  LINK_MIN_TAP_HEIGHT,
  REFERENCE_MARGIN,
  REFERENCE_MAX_LINES,
  TRANSLATION_MARGIN,
  TRANSLATION_MAX_LINES,
  VERSE_MARGIN,
  composeCardLabel,
  fitPassageCardRegions,
  passageCardStackHeight,
  scrimRampStart,
  scrimSolidStop,
  verseTypography,
} from "../../lib/bibleCardFit"
import {
  CARD_TREATMENT,
  FROSTED_BLUR_INTENSITY,
  FROSTED_TINT,
} from "../../lib/bibleCardTreatment"
import { datadogLog } from "../../lib/datadog"
import { PlatformBlur } from "../ui/PlatformBlur"
import { openPassageSheet } from "../../lib/openPassageSheet"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type { BibleQuoteBlock } from "../../hooks/useBibleVerses"
import type { AdminBlock } from "../../lib/queries"

// ── Types ───────────────────────────────────────────────────────────────────

// The passage-only fields are OPTIONAL on purpose: this renderer also serves
// the Experience and SDUI content paths, whose quote items carry none of them.
// Rendering each region only when its value is present is what keeps those two
// surfaces byte-identical to today.
//
// They are DERIVED from the hook's card type rather than re-declared, because
// the two meet through `AdminBlock`'s `Record<string, unknown>` index signature
// — a rename on either side would typecheck clean and silently stop rendering
// the credit. `text` is widened because admin's Experience quote type declares
// it nullable.
type QuoteItem = {
  reference: string
  text: string | null
  attribution?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
  ctaLabel?: string | null
  ctaLink?: string | null
} & Partial<
  Pick<
    BibleQuoteBlock,
    | "translation"
    | "copyright"
    | "passageUrl"
    | "loading"
    | "artCandidates"
    | "artIndex"
  >
>

export interface BibleQuotesCarouselRendererProps {
  section: AdminBlock
  /**
   * A card's artwork failed to load; the owning layer advances its rung. An
   * explicit prop, not a passenger on the block bag: the ladder's index lives
   * above this component and the card only reports upward.
   */
  onArtworkFailed?: (cardIndex: number, failedUrl: string) => void
  /**
   * The video the cards belong to, for the exhaustion signal only. A reference
   * recurs across many videos, so without it a spike cannot be told apart from
   * one bad asset, nor joined to `bible_card_art.resolved`.
   */
  videoSlug?: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const HORIZONTAL_PADDING = 16
const CARD_GAP = 12
const FALLBACK_BG = "#292524"
const READ_PASSAGE_LABEL = "Read full passage"

/**
 * The scrim is opaque behind the text stack, so this does NOT carry the
 * contrast floor — it holds an edge where a bright still meets the ramp above
 * the stack. Layout-neutral, so it costs the fit arithmetic nothing.
 */
const CARD_TEXT_SHADOW = {
  textShadowColor: "rgba(0, 0, 0, 0.6)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const

/**
 * Opacity at the card's TOP edge, so no still renders at full strength. Does
 * NOT carry the 4.5:1 floor — `scrimSolidStop` puts the text over solid colour.
 */
const SCRIM_TOP_OPACITY = 0.3

/**
 * The credit lines. Under a uniform tint they must be OPAQUE: the tint shows
 * through a translucent glyph, dropping the foreground as it darkens the
 * backdrop. Hierarchy is carried by size and weight instead.
 */
const TRANSLATION_COLOR =
  CARD_TREATMENT === "frosted" ? TEXT_ON_OVERLAY : "rgba(255, 255, 255, 0.65)"
const COPYRIGHT_COLOR =
  CARD_TREATMENT === "frosted" ? TEXT_ON_OVERLAY : "rgba(255, 255, 255, 0.55)"

/**
 * A NUMBER, never an object without a duration: that form defaults to 100ms on
 * iOS and 0 on Android, so it would fade on iOS and not at all on Android —
 * and an iOS-only device check would pass.
 */
const STILL_FADE_MS = 200

/**
 * How far ahead stills are requested. TWO, not one: the list already mounts
 * `initialNumToRender` cells, whose own `<Image>` requests the same URL, so
 * targeting +1 only re-asked for a load already in flight and bounded nothing.
 */
const PREFETCH_AHEAD = 2

/**
 * Final release for the prefetch gate, so a load that neither completes nor
 * errors cannot suppress the prefetch for the rest of the session.
 */
const PREFETCH_RELEASE_MS = 3000

const NOTHING_SETTLED: ReadonlySet<number> = new Set()

// ── QuoteCard ───────────────────────────────────────────────────────────────

/** Reserved-height stand-in for the verse while the passage read is in flight. */
function VerseLoading({ typography }: { typography: TypographyScale }) {
  const opacity = useShimmerOpacity()
  return (
    <Animated.View
      style={[styles.verseLoading, { opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0.95, 0.85, 0.6].map((widthFraction) => (
        <View
          key={widthFraction}
          style={[
            styles.verseLoadingBar,
            {
              height: Math.round(typography.body.lineHeight * 0.6),
              width: `${widthFraction * 100}%`,
            },
          ]}
        />
      ))}
    </Animated.View>
  )
}

function QuoteCard({
  quote,
  cardIndex,
  cardWidth,
  typography,
  fontScale,
  reduceMotion,
  onOpenPassage,
  onArtworkFailed,
  onArtworkSettled,
  videoSlug,
}: {
  quote: QuoteItem
  cardIndex: number
  cardWidth: number
  typography: TypographyScale
  fontScale: number
  reduceMotion: boolean
  onOpenPassage?: (url: string) => void
  onArtworkFailed?: (cardIndex: number, failedUrl: string) => void
  onArtworkSettled?: (cardIndex: number) => void
  videoSlug?: string
}) {
  const bgColor = quote.backgroundColor ?? FALLBACK_BG
  const scrimTop = hexToRgba(bgColor, SCRIM_TOP_OPACITY)
  // Retained deliberately: idempotent on a URL the derivation already
  // validated, and the ONLY URL check the Experience and SDUI paths get.
  const imageUrl = resolveImageUrl(quote.imageUrl ?? null)
  const loading = quote.loading === true

  const artCandidates = quote.artCandidates ?? []
  const artIndex = quote.artIndex ?? 0
  const warnedIndexRef = useRef<number | null>(null)

  const passageUrl =
    quote.passageUrl != null && validateActionUrl(quote.passageUrl)
      ? quote.passageUrl
      : null

  // R14: only a passage-fed card has credit to protect, so only it takes the
  // clamp and the drop order. The Experience and SDUI cards carry none of
  // these fields and keep today's unclamped verse.
  const hasPassage =
    quote.translation != null ||
    quote.copyright != null ||
    quote.passageUrl != null

  // `BibleQuoteItem.text` is nullable in admin's schema and the shared
  // Experience fragment selects it raw, so this card really can be handed null.
  // The code this replaced passed it straight to `<Text>` and a template
  // literal, both of which accept null; `.length` and `.trim()` do not.
  const verseText = typeof quote.text === "string" ? quote.text : ""

  const showVerse = !loading && verseText.length > 0

  // The card is a fixed square and its content is bottom-aligned, so the drop
  // order has to be decided here rather than left to overflow.
  const fitInput = {
    contentHeight: cardWidth - CARD_CONTENT_PADDING * 2,
    typography,
    fontScale,
    hasVerse: showVerse,
    hasTranslation: !loading && quote.translation != null,
    hasCopyright: !loading && quote.copyright != null,
    hasLink: !loading && passageUrl != null,
  }
  const regions = fitPassageCardRegions(fitInput)

  // The card is a square, so its height is its width. The scrim reaches the
  // card colour at the top of the text stack, which is what puts every text
  // region over a solid backdrop for ANY still — not just a sampled one.
  const solidStop = scrimSolidStop(
    cardWidth,
    passageCardStackHeight(fitInput, regions),
  )

  const reportArtworkFailure = () => {
    // Settled either way: an errored image is as done competing for bandwidth
    // as a loaded one, and gating the prefetch on load alone would suppress it
    // for the rest of the session on an ordinary failure.
    onArtworkSettled?.(cardIndex)
    if (artCandidates.length === 0) return
    // Terminal: every rung failed, so the card settles at its background
    // colour — visually identical to loading, and countable only here. Deduped
    // per rung because one failed load can report `onError` more than once.
    if (
      artIndex >= artCandidates.length - 1 &&
      warnedIndexRef.current !== artIndex
    ) {
      warnedIndexRef.current = artIndex
      datadogLog.warn("bible_card_art.exhausted", {
        reference: quote.reference,
        candidate_count: artCandidates.length,
        slug: videoSlug ?? null,
      })
    }
    // The URL THIS render handed the image, never `artCandidates[artIndex]`
    // re-read: one load can report `onError` twice, and by the second report
    // the index has advanced — failing a rung that was never actually tried.
    if (imageUrl != null) onArtworkFailed?.(cardIndex, imageUrl)
  }

  return (
    <View
      style={[
        card.base,
        styles.localCard,
        { width: cardWidth, backgroundColor: bgColor },
      ]}
      accessible
      accessibilityLabel={
        loading
          ? `${quote.reference}, loading`
          : composeCardLabel(quote.reference, verseText)
      }
    >
      {imageUrl != null && (
        <Image
          // A rung change mounts a FRESH node, so a native error still in
          // flight for the previous URL is delivered to an unmounted one and
          // dropped rather than charged against the rung that replaced it.
          key={imageUrl}
          source={imageUrl}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          contentFit="cover"
          // Off the RESOLVED source, not the reference label: two citations can
          // share a label and would otherwise be told they are the same image.
          recyclingKey={imageUrl}
          // memory-disk on both tiers. Disk is what makes a still identical
          // across launches; memory is what stops the carousel's unmount-and-
          // remount windowing re-decoding on every scroll back.
          cachePolicy="memory-disk"
          // The carousel mounts its first cells at watch-screen mount rather
          // than when scrolled into view, so an unranked still competes with
          // player startup on the design-centre device.
          priority="low"
          // The fade lives on expo-image's own transition, so it animates the
          // image node alone. Animating a wrapper would take the scrim with it
          // — Android applies a group's opacity to each child.
          transition={reduceMotion ? 0 : STILL_FADE_MS}
          onLoad={() => onArtworkSettled?.(cardIndex)}
          onError={reportArtworkFailure}
          // Decorative: the card is one grouped element and already announces
          // its own composed label.
          accessible={false}
          importantForAccessibility="no"
        />
      )}
      {/* Three stops, not two: the veil HOLDS at its top value until one band
          above the text, then turns solid. Ramping from the card's edge would
          dim the still across the whole region it actually occupies. */}
      {CARD_TREATMENT === "scrim" && (
        <LinearGradient
          colors={[scrimTop, scrimTop, bgColor]}
          locations={[0, scrimRampStart(solidStop), solidStop]}
          style={styles.gradient}
          pointerEvents="none"
        />
      )}
      {/* Only over a real image: with no still the card colour is already
          solid and safe, so tinting would just darken it for nothing — and
          that is the state the Experience and SDUI paths always render. */}
      {CARD_TREATMENT === "frosted" && imageUrl != null && (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {/* Blur is aesthetic and iOS-only, so `androidDim` is transparent —
              the tint below is what holds the floor, identically on both. */}
          <PlatformBlur
            intensity={FROSTED_BLUR_INTENSITY}
            style={StyleSheet.absoluteFill}
            androidDim="transparent"
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: FROSTED_TINT }]}
          />
        </View>
      )}
      <View style={styles.cardContent}>
        {quote.attribution != null && (
          <Text style={[styles.attribution, typography.caption]}>
            {quote.attribution.toUpperCase()}
          </Text>
        )}
        <Text
          style={[styles.reference, typography.bodySmall]}
          // The fit arithmetic budgets exactly REFERENCE_MAX_LINES for this
          // region. Without the clamp a long reference wraps past its budget,
          // the bottom-aligned stack overflows, and the clip takes the
          // reference off the TOP — the one region the drop order protects.
          numberOfLines={hasPassage ? REFERENCE_MAX_LINES : undefined}
        >
          {quote.reference.toUpperCase()}
        </Text>
        {loading && <VerseLoading typography={typography} />}
        {/* `verseLines === 0` is the fit's "drop the verse" outcome. It must be
            honoured HERE: React Native maps numberOfLines={0} to UNSET, so
            passing it through would render the verse with NO limit — the exact
            overflow the drop order exists to prevent. The Experience path never
            consults it, so that surface is unchanged. */}
        {showVerse && (!hasPassage || regions.verseLines > 0) && (
          <Text
            style={[
              styles.quoteText,
              // Scoped to passage cards. The Experience path has no fit
              // arithmetic behind it, so enlarging its text there would
              // overflow with nothing to catch it (R14 keeps it as it is).
              hasPassage
                ? [styles.passageVerse, verseTypography(typography)]
                : [styles.authoredVerse, typography.body],
            ]}
            numberOfLines={hasPassage ? regions.verseLines : undefined}
          >
            {verseText}
          </Text>
        )}
        {regions.translation && quote.translation != null && (
          <Text
            style={[styles.translation, typography.caption]}
            numberOfLines={TRANSLATION_MAX_LINES}
          >
            {quote.translation}
          </Text>
        )}
        {regions.copyright && quote.copyright != null && (
          <Text
            style={[styles.copyright, typography.caption]}
            numberOfLines={COPYRIGHT_MAX_LINES}
          >
            {quote.copyright}
          </Text>
        )}
        {regions.link && passageUrl != null && (
          <Pressable
            style={({ pressed }) => [
              styles.passageLink,
              onOpenPassage == null && styles.passageLinkDisabled,
              pressed && styles.passageLinkPressed,
            ]}
            // U6 supplies the handler. A link with no handler must never be
            // tappable, so the affordance disables itself rather than
            // depending on landing order.
            disabled={onOpenPassage == null}
            onPress={() => onOpenPassage?.(passageUrl)}
            accessibilityRole="link"
            accessibilityLabel={READ_PASSAGE_LABEL}
          >
            <Text style={[styles.passageLinkText, typography.bodySmall]}>
              {READ_PASSAGE_LABEL}
            </Text>
          </Pressable>
        )}
        {(() => {
          const ctaLink = quote.ctaLink
          const ctaLabel = quote.ctaLabel
          if (
            ctaLabel == null ||
            ctaLink == null ||
            !validateActionUrl(ctaLink)
          )
            return null
          return (
            <Pressable
              style={({ pressed }) => [
                styles.ctaButton,
                pressed && styles.ctaButtonPressed,
              ]}
              onPress={() => Linking.openURL(ctaLink)}
              accessibilityRole="link"
              accessibilityLabel={ctaLabel}
            >
              <Text style={[styles.ctaText, typography.bodySmall]}>
                {ctaLabel}
              </Text>
            </Pressable>
          )
        })()}
      </View>
    </View>
  )
}

// ── Pagination ──────────────────────────────────────────────────────────────

function PaginationDots({
  count,
  activeIndex,
}: {
  count: number
  activeIndex: number
}) {
  if (count <= 1) return null
  return (
    <View
      style={styles.dotsContainer}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[styles.dot, i === activeIndex && styles.dotActive]}
        />
      ))}
    </View>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function BibleQuotesCarouselRenderer({
  section,
  onArtworkFailed,
  videoSlug,
}: BibleQuotesCarouselRendererProps) {
  const typography = useTypography()
  const reduceMotion = useReduceMotion()
  const { width: screenWidth, fontScale } = useWindowDimensions()
  const flatListRef = useRef<FlatList<QuoteItem>>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const s = section as Record<string, unknown>
  const heading = s.heading as string | null
  const quotes = (s.quotes as QuoteItem[] | undefined) ?? []

  const cardWidth = Math.round(screenWidth - HORIZONTAL_PADDING * 2)

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x
      const index = Math.round(offsetX / (cardWidth + CARD_GAP))
      setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
    },
    [quotes.length, cardWidth],
  )

  const scrollToIndex = useCallback((index: number) => {
    flatListRef.current?.scrollToIndex({ index, animated: true })
  }, [])

  // ── Bounded prefetch ──────────────────────────────────────────────────────

  const [settledCards, setSettledCards] =
    useState<ReadonlySet<number>>(NOTHING_SETTLED)
  const [releasedFor, setReleasedFor] = useState<number | null>(null)
  // Keyed by URL, not by index: the ladder can hand a card a different rung,
  // and that new URL has not been prefetched even though its index has.
  const prefetchedRef = useRef<Set<string>>(new Set())

  const handleArtworkSettled = useCallback((cardIndex: number) => {
    setSettledCards((prev) => {
      if (prev.has(cardIndex)) return prev
      const next = new Set(prev)
      next.add(cardIndex)
      return next
    })
  }, [])

  // The INDEX released, never a boolean. React runs every passive effect for a
  // commit before applying the state they queue, so on a scroll a boolean reset
  // here was still read as `true` below — opening the gate on every new card.
  useEffect(() => {
    const timer = setTimeout(
      () => setReleasedFor(activeIndex),
      PREFETCH_RELEASE_MS,
    )
    return () => clearTimeout(timer)
  }, [activeIndex])

  useEffect(() => {
    // A card with nothing to load is already settled — waiting on an image it
    // will never request would suppress the prefetch for the whole session.
    const visibleUrl = resolveImageUrl(quotes[activeIndex]?.imageUrl ?? null)
    const visibleSettled =
      visibleUrl == null ||
      settledCards.has(activeIndex) ||
      releasedFor === activeIndex
    if (!visibleSettled) return

    const nextIndex = activeIndex + PREFETCH_AHEAD
    if (nextIndex >= quotes.length) return

    const url = resolveImageUrl(quotes[nextIndex]?.imageUrl ?? null)
    // Never an empty list: the promise resolves only from inside a per-URL
    // callback, so an empty array never settles at all.
    if (url == null || prefetchedRef.current.has(url)) return
    prefetchedRef.current.add(url)
    void Image.prefetch([url], { cachePolicy: "memory-disk" })
  }, [activeIndex, settledCards, releasedFor, quotes])

  // KTD9: deliberately NOT registered as a non-route sheet id. The floating
  // window cannot be present on the watch route — `miniPlayerPresentation`
  // returns the full-player presentation there before it consults sheet
  // suppression — and a passage-fed card exists only on that route. Registering
  // an id would be dead code whose device check passed vacuously.
  const handleOpenPassage = useCallback((url: string) => {
    void openPassageSheet(url)
  }, [])

  const renderQuoteItem = useCallback(
    ({ item, index }: { item: QuoteItem; index: number }) => (
      <QuoteCard
        key={`bqc-${index}`}
        quote={item}
        cardIndex={index}
        cardWidth={cardWidth}
        typography={typography}
        fontScale={fontScale}
        reduceMotion={reduceMotion}
        onOpenPassage={handleOpenPassage}
        onArtworkFailed={onArtworkFailed}
        onArtworkSettled={handleArtworkSettled}
        videoSlug={videoSlug}
      />
    ),
    [
      cardWidth,
      typography,
      fontScale,
      reduceMotion,
      handleOpenPassage,
      onArtworkFailed,
      handleArtworkSettled,
      videoSlug,
    ],
  )

  const keyExtractor = useCallback(
    (_item: QuoteItem, index: number) => `bqc-${index}`,
    [],
  )

  const getItemLayout = useCallback(
    (_data: ArrayLike<QuoteItem> | null | undefined, index: number) => ({
      length: cardWidth + CARD_GAP,
      offset: index * (cardWidth + CARD_GAP),
      index,
    }),
    [cardWidth],
  )

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message:
          "Check out the JesusFilm app!\nhttps://www.jesusfilm.org/watch",
      })
    } catch {
      // User dismissed or share unavailable
    }
  }, [])

  if (quotes.length === 0) return null

  return (
    <View style={layout.sectionOuter}>
      <View style={[layout.headerRow, styles.localHeaderRow]}>
        {heading != null && (
          <Text
            style={[
              text.sectionHeading,
              styles.localHeading,
              typography.titleLarge,
            ]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
        )}
        <Pressable
          onPress={handleShare}
          style={[button.iconButton44, styles.localShareButton]}
          accessibilityRole="button"
          accessibilityLabel="Share"
        >
          <Ionicons name="share-outline" size={22} color={ACCENT} />
        </Pressable>
      </View>
      <FlatList
        ref={flatListRef}
        data={quotes}
        renderItem={renderQuoteItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        decelerationRate="fast"
        // ONE, so only the visible card requests a still while the player is
        // starting. `windowSize` still mounts the neighbour in a later batch,
        // which is what keeps the first swipe from meeting an empty cell.
        initialNumToRender={1}
        windowSize={3}
        getItemLayout={getItemLayout}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${quotes.length} Bible quotes`}
        accessibilityValue={{
          text: `Item ${activeIndex + 1} of ${quotes.length}`,
        }}
        accessibilityActions={[
          { name: "increment", label: "Next quote" },
          { name: "decrement", label: "Previous quote" },
        ]}
        onAccessibilityAction={(event) => {
          switch (event.nativeEvent.actionName) {
            case "increment": {
              const next = Math.min(activeIndex + 1, quotes.length - 1)
              setActiveIndex(next)
              scrollToIndex(next)
              break
            }
            case "decrement": {
              const prev = Math.max(activeIndex - 1, 0)
              setActiveIndex(prev)
              scrollToIndex(prev)
              break
            }
          }
        }}
      />
      <PaginationDots count={quotes.length} activeIndex={activeIndex} />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localHeaderRow: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 16,
  },
  localHeading: {
    flex: 1,
  },
  localShareButton: {
    marginLeft: "auto",
  },
  localCard: {
    overflow: "hidden",
    aspectRatio: 1,
  },
  cardImage: {
    borderRadius: 12,
  },
  // From the card's TOP edge, not 20% down: starting lower left the still at
  // full strength across the upper band. The first STOP carries the opacity —
  // moving the origin alone would have changed nothing.
  gradient: {
    ...StyleSheet.absoluteFill,
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    // Every value the fit arithmetic reserves height for is imported from
    // bibleCardFit, so a style edit cannot silently invalidate its decisions.
    padding: CARD_CONTENT_PADDING,
  },
  attribution: {
    ...CARD_TEXT_SHADOW,
    fontWeight: "800",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  // Not bold: the verse now carries the card's weight, and two heavy elements
  // stacked read as competing headings. The uppercase letterSpacing is what
  // keeps this an eyebrow.
  reference: {
    ...CARD_TEXT_SHADOW,
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    letterSpacing: 1.5,
    marginBottom: REFERENCE_MARGIN,
  },
  quoteText: {
    ...CARD_TEXT_SHADOW,
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    marginBottom: VERSE_MARGIN,
  },
  // Scripture reads upright and bold, larger than the body copy around it. Its
  // size comes from `verseTypography` so the fit budget cannot drift. Weight
  // does not affect the fit: the budget is by line height, not by glyph width.
  passageVerse: {
    fontStyle: "normal",
    fontWeight: "700",
  },
  // The Experience carousel's authored quotes keep today's presentation.
  authoredVerse: {
    fontStyle: "italic",
  },
  // NOT routed through `attribution` above: that field renders as an uppercase
  // heavy eyebrow, which is wrong for a translation name and a copyright line.
  translation: {
    ...CARD_TEXT_SHADOW,
    fontWeight: "600",
    color: TRANSLATION_COLOR,
    fontFamily: "System",
    marginBottom: TRANSLATION_MARGIN,
  },
  copyright: {
    ...CARD_TEXT_SHADOW,
    color: COPYRIGHT_COLOR,
    fontFamily: "System",
  },
  passageLink: {
    marginTop: LINK_MARGIN_TOP,
    alignSelf: "flex-start",
    minHeight: LINK_MIN_TAP_HEIGHT,
    justifyContent: "center",
  },
  passageLinkDisabled: {
    opacity: 0.5,
  },
  passageLinkPressed: {
    opacity: 0.7,
  },
  passageLinkText: {
    ...CARD_TEXT_SHADOW,
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    textDecorationLine: "underline",
  },
  verseLoading: {
    marginBottom: 6,
    gap: 6,
  },
  verseLoadingBar: {
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  ctaButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    minHeight: 48,
    justifyContent: "center",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    ...CARD_TEXT_SHADOW,
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  dotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
})
