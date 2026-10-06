import type { TypedDocumentNode } from "@apollo/client"
import { print } from "graphql"
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"
import { z } from "zod"
import {
  adminCreateRecommendationViewerOperation,
  adminUpdateRecommendationViewerOperation,
  adminUserRecommendationsOperation,
  adminSelectSemanticRecommendationOperation,
  adminClaimSemanticRecommendationEpisodeOperation,
  adminIssueWatchPlaybackContextOperation,
  adminRecordSemanticRecommendationEvidenceOperation,
  adminRecordSemanticRecommendationPlaybackOperation,
} from "@forge/admin-graphql/operations"
import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import { getApiToken, getGraphQLUrl } from "../config"
import { authHeadersForOperation } from "../authHeaders"
import { createIdentityStore } from "./identity"
import { createEvidenceQueue } from "./evidenceQueue"

export const recommendationsEnabled = () =>
  process.env.EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED === "true"
export const EVIDENCE_CONTRACT = "recommendation-evidence-v1"
const IDENTITY_KEY = "tv.recommendations.identity.v1"
const CHOICE_KEY = "tv.recommendations.choice.v1"
const WITHDRAW_PENDING_KEY = "tv.recommendations.withdraw-pending.v1"
let controlBusy = false
const identitySchema = z.object({
  viewerToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime(),
  lastActivity: z.number().finite().nonnegative(),
})

export class RecommendationRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super("Recommendation request unavailable")
    this.name = "RecommendationRequestError"
  }
}

async function request<Data, Variables extends Record<string, unknown>>(
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
): Promise<Data> {
  const definition = document.definitions.find(
    (d) => d.kind === "OperationDefinition",
  )
  const operationName =
    definition?.kind === "OperationDefinition"
      ? definition.name?.value
      : undefined
  if (!getApiToken()) throw new RecommendationRequestError("authentication")
  if (
    controlBusy &&
    operationName !== "CreateRecommendationViewer" &&
    operationName !== "UpdateRecommendationViewer"
  )
    throw new RecommendationRequestError("control_pending")
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        controller.abort()
        reject(new RecommendationRequestError("transport", true))
      },
      operationName === "UserRecommendations" ? 2200 : 5000,
    )
  })
  try {
    const response = await Promise.race([
      fetch(getGraphQLUrl(), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...authHeadersForOperation(operationName, getApiToken()),
        },
        body: JSON.stringify({
          query: print(document),
          variables,
          operationName,
        }),
      }),
      deadline,
    ])
    const body = (await Promise.race([response.json(), deadline])) as {
      data?: Data
      errors?: { extensions?: { recommendationCode?: string; code?: string } }[]
    }
    if (!response.ok || body.errors?.length || !body.data) {
      const code =
        body.errors?.[0]?.extensions?.recommendationCode ??
        body.errors?.[0]?.extensions?.code ??
        "transport"
      throw new RecommendationRequestError(
        code,
        ![
          "UNAUTHENTICATED",
          "BAD_USER_INPUT",
          "invalid_binding",
          "CONFLICT",
        ].includes(code) &&
          (response.status >= 500 ||
            [
              "transport",
              "SERVICE_UNAVAILABLE",
              "INTERNAL_SERVER_ERROR",
            ].includes(code)),
      )
    }
    return body.data
  } catch (error) {
    if (error instanceof RecommendationRequestError) throw error
    throw new RecommendationRequestError("transport", true)
  } finally {
    clearTimeout(timeout)
  }
}

export function randomSessionToken() {
  const bytes = Crypto.getRandomBytes(32)
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let token = ""
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 6) {
      bits -= 6
      token += alphabet[(buffer >>> bits) & 63]
    }
  }
  if (bits) token += alphabet[(buffer << (6 - bits)) & 63]
  return token
}
async function requestIdempotent<
  Data,
  Variables extends Record<string, unknown>,
>(
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
): Promise<Data> {
  return new Promise((resolve, reject) => {
    const queue = createEvidenceQueue<Variables>({
      send: async (batch) => {
        resolve(await request(document, batch[0]))
      },
      failed: reject,
      retryable: (error) =>
        error instanceof RecommendationRequestError && error.retryable,
      now: () => performance.now(),
    })
    queue.push([variables])
  })
}

export const readPersonalizationChoice = async () => {
  const value = await SecureStore.getItemAsync(CHOICE_KEY)
  return value === "false" ? false : value === "true" ? true : null
}

export const recommendationIdentity = createIdentityStore({
  read: async () => {
    const raw = await SecureStore.getItemAsync(IDENTITY_KEY)
    if (!raw) return null
    try {
      return identitySchema.parse(JSON.parse(raw))
    } catch {
      return null
    }
  },
  write: (identity) =>
    SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity)),
  readChoice: readPersonalizationChoice,
  bootstrap: async () => {
    const data = await request(adminCreateRecommendationViewerOperation, {})
    if (!data.createRecommendationViewer)
      throw new RecommendationRequestError("bootstrap")
    return data.createRecommendationViewer
  },
  transition: async (identity, action) => {
    await request(adminUpdateRecommendationViewerOperation, {
      ...identity,
      action,
    })
  },
  randomToken: randomSessionToken,
  now: Date.now,
  onAuthorityChanged: clearRecommendationContext,
})
let identityFlight: Promise<
  Awaited<ReturnType<typeof recommendationIdentity.get>>
> | null = null
function getIdentity() {
  if (identityFlight) return identityFlight
  const flight = (async () => {
    const identity = await recommendationIdentity.get()
    if ((await SecureStore.getItemAsync(WITHDRAW_PENDING_KEY)) === "true") {
      await request(adminUpdateRecommendationViewerOperation, {
        ...identity,
        action: "withdraw",
      })
      await SecureStore.deleteItemAsync(WITHDRAW_PENDING_KEY)
    }
    return identity
  })()
  identityFlight = flight
  const release = () => {
    if (identityFlight === flight) identityFlight = null
  }
  void flight.then(release, release)
  return flight
}

export type Delivery = NonNullable<
  AdminResultOf<typeof adminUserRecommendationsOperation>["userRecommendations"]
>
export type RecommendationItem = Delivery["items"][number]
export type Attribution = {
  privacyGeneration: number
  delivery: Delivery
  item: RecommendationItem
  audioLanguageSlug: string
  claimNonce?: string
  selectedAt?: number
}
export type Episode = NonNullable<
  AdminResultOf<
    typeof adminClaimSemanticRecommendationEpisodeOperation
  >["claimSemanticRecommendationEpisode"]
> & {
  mediaId: string
  viewerToken: string
  sessionToken: string
  privacyGeneration: number
}
const pendingSelections = new Map<string, Attribution>()
const claimedNonces = new Set<string>()
let privacyGeneration = 0
const listeners = new Set<() => void>()
export function subscribeRecommendations(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function getRecommendationGeneration() {
  return privacyGeneration
}
export function clearRecommendationContext() {
  privacyGeneration++
  pendingSelections.clear()
  claimedNonces.clear()
  listeners.forEach((listener) => listener())
}
export function takeRecommendationSelection(slug: string) {
  const attribution = pendingSelections.get(slug)
  pendingSelections.delete(slug)
  return attribution
}

export async function changePersonalization(
  action: "reset" | "grant" | "withdraw",
) {
  if (controlBusy) throw new RecommendationRequestError("control_pending")
  controlBusy = true
  clearRecommendationContext()
  try {
    const identity = await getIdentity()
    const previous = await readPersonalizationChoice()
    if (action === "withdraw")
      await SecureStore.setItemAsync(CHOICE_KEY, "false")
    if (action === "withdraw" || previous === false)
      await SecureStore.setItemAsync(WITHDRAW_PENDING_KEY, "true")
    const data = await request(adminUpdateRecommendationViewerOperation, {
      ...identity,
      action,
    })
    if (action === "reset" && previous === false) {
      await request(adminUpdateRecommendationViewerOperation, {
        ...identity,
        action: "withdraw",
      })
    } else if (action !== "reset") {
      await SecureStore.setItemAsync(CHOICE_KEY, String(action === "grant"))
    }
    await SecureStore.deleteItemAsync(WITHDRAW_PENDING_KEY)
    return action === "reset"
      ? previous !== false
      : data.updateRecommendationViewer?.personalization === true
  } finally {
    controlBusy = false
    clearRecommendationContext()
  }
}

export async function fetchForYou(
  audioLanguageSlug: string,
): Promise<Delivery> {
  return loadForYou(audioLanguageSlug, true)
}
async function loadForYou(
  audioLanguageSlug: string,
  recover: boolean,
): Promise<Delivery> {
  const identity = await getIdentity()
  let data: AdminResultOf<typeof adminUserRecommendationsOperation>
  try {
    data = await request(adminUserRecommendationsOperation, {
      viewerToken: identity.viewerToken,
      sessionToken: identity.sessionToken,
      locale: "en",
      audioLanguageSlug,
      count: 6,
    })
  } catch (error) {
    if (
      recover &&
      error instanceof RecommendationRequestError &&
      error.code === "UNAUTHENTICATED"
    ) {
      recommendationIdentity.forget()
      return loadForYou(audioLanguageSlug, false)
    }
    throw error
  }
  if (!data.userRecommendations)
    throw new RecommendationRequestError("unavailable")
  return data.userRecommendations
}

export async function selectRecommendation(
  attribution: Attribution,
): Promise<string> {
  if (
    !attribution.delivery.requestId ||
    attribution.privacyGeneration !== privacyGeneration
  )
    throw new RecommendationRequestError("delivery")
  const identity = await getIdentity()
  if (attribution.privacyGeneration !== privacyGeneration)
    throw new RecommendationRequestError("retired")
  const generation = privacyGeneration
  const claimNonce = Crypto.randomUUID()
  const data = await requestIdempotent(
    adminSelectSemanticRecommendationOperation,
    {
      ...identity,
      contractVersion: EVIDENCE_CONTRACT,
      capability: attribution.item.capability,
      requestId: attribution.delivery.requestId,
      itemId: attribution.item.id,
      eventId: Crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      claimNonce,
    },
  )
  const selection = data.selectSemanticRecommendation
  if (
    !selection ||
    selection.status !== "accepted" ||
    generation !== privacyGeneration ||
    selection.targetMediaId !== attribution.item.targetMediaId
  )
    throw new RecommendationRequestError("selection")
  const slug = attribution.item.videoSlug
  if (!slug || !/^\/(?:[a-z]{2,3}\/)?watch\//.test(selection.canonicalHref))
    throw new RecommendationRequestError("destination")
  pendingSelections.set(slug, {
    ...attribution,
    claimNonce,
    selectedAt: Date.now(),
  })
  return slug
}

export async function claimPlayback(
  mediaId: string,
  source: "direct" | "search" | "editorial",
  attribution?: Attribution,
): Promise<Episode> {
  if (attribution && attribution.privacyGeneration !== privacyGeneration)
    throw new RecommendationRequestError("retired")
  let identity = await getIdentity()
  try {
    await request(adminUpdateRecommendationViewerOperation, {
      ...identity,
      action: "status",
    })
  } catch (error) {
    if (
      !(error instanceof RecommendationRequestError) ||
      error.code !== "UNAUTHENTICATED"
    )
      throw error
    recommendationIdentity.forget()
    identity = await getIdentity()
    await request(adminUpdateRecommendationViewerOperation, {
      ...identity,
      action: "status",
    })
  }
  if (attribution && attribution.privacyGeneration !== privacyGeneration)
    throw new RecommendationRequestError("retired")
  const generation = privacyGeneration
  let nonce = attribution?.claimNonce
  const targetMediaId = attribution?.item.targetMediaId ?? mediaId
  if (attribution) {
    if (
      nonce &&
      (claimedNonces.has(nonce) ||
        Date.now() - (attribution.selectedAt ?? 0) >= 590000)
    ) {
      const slug = await selectRecommendation(attribution)
      nonce = takeRecommendationSelection(slug)?.claimNonce
    }
    if (!nonce) throw new RecommendationRequestError("selection")
  } else {
    const context = await request(adminIssueWatchPlaybackContextOperation, {
      ...identity,
      mediaId: targetMediaId,
      discoverySource: source,
      provenance: { client: "tv" },
    })
    nonce = context.issueWatchPlaybackContext?.claimNonce
  }
  if (!nonce) throw new RecommendationRequestError("context")
  claimedNonces.add(nonce)
  if (claimedNonces.size > 128)
    claimedNonces.delete(claimedNonces.values().next().value!)
  const data = await requestIdempotent(
    adminClaimSemanticRecommendationEpisodeOperation,
    {
      ...identity,
      mediaId: targetMediaId,
      claimNonce: nonce,
    },
  )
  if (
    !data.claimSemanticRecommendationEpisode ||
    generation !== privacyGeneration
  )
    throw new RecommendationRequestError("claim")
  return {
    ...data.claimSemanticRecommendationEpisode,
    viewerToken: identity.viewerToken,
    sessionToken: identity.sessionToken,
    mediaId: targetMediaId,
    privacyGeneration: generation,
  }
}

export type PlaybackEvents = AdminVariablesOf<
  typeof adminRecordSemanticRecommendationPlaybackOperation
>["events"]
export async function sendPlayback(episode: Episode, events: PlaybackEvents) {
  if (episode.privacyGeneration !== privacyGeneration) return
  const data = await request(
    adminRecordSemanticRecommendationPlaybackOperation,
    {
      contractVersion: EVIDENCE_CONTRACT,
      ...episode,
      events,
    },
  )
  const receipts = data.recordSemanticRecommendationPlayback
  if (
    !receipts ||
    receipts.length !== events.length ||
    events.some(
      (event) => !receipts.some((receipt) => receipt.eventId === event.eventId),
    )
  )
    throw new RecommendationRequestError("acknowledgement", true)
  if (
    receipts.some(
      (receipt) => receipt.status !== "accepted" && receipt.status !== "replay",
    )
  )
    throw new RecommendationRequestError("rejected")
}
export async function sendCardEvidence(
  attribution: Attribution,
  kind?: "render" | "impression",
) {
  if (
    !attribution.delivery.requestId ||
    attribution.privacyGeneration !== privacyGeneration
  )
    throw new RecommendationRequestError("delivery")
  const identity = await getIdentity()
  const variables = {
    ...identity,
    contractVersion: EVIDENCE_CONTRACT,
    capability: attribution.item.capability,
    requestId: attribution.delivery.requestId,
    itemId: attribution.item.id,
    events: (kind ? [kind] : ["render", "impression"]).map((eventKind) => ({
      eventId: Crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      kind: eventKind,
      payload:
        eventKind === "render"
          ? { surfacePolicy: "watch-for-you-v1" }
          : { visibilityPolicy: "watch-for-you-v1" },
    })),
  }
  await new Promise<void>((resolve, reject) => {
    const queue = createEvidenceQueue<(typeof variables.events)[number]>({
      send: async (events) => {
        if (attribution.privacyGeneration !== privacyGeneration)
          throw new RecommendationRequestError("retired")
        const data = await request(
          adminRecordSemanticRecommendationEvidenceOperation,
          { ...variables, events },
        )
        if (
          data.recordSemanticRecommendationEvidence?.length !== events.length ||
          events.some(
            (event) =>
              !data.recordSemanticRecommendationEvidence?.some(
                (receipt) => receipt.eventId === event.eventId,
              ),
          )
        )
          throw new RecommendationRequestError("acknowledgement", true)
        if (
          data.recordSemanticRecommendationEvidence.some(
            (receipt) =>
              receipt.status !== "accepted" && receipt.status !== "replay",
          )
        )
          throw new RecommendationRequestError("rejected")
        resolve()
      },
      failed: reject,
      retryable: (error) =>
        error instanceof RecommendationRequestError && error.retryable,
      now: () => performance.now(),
    })
    queue.push(variables.events)
  })
}
