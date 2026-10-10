import { createHmac, timingSafeEqual } from "node:crypto"
import {
  DEFAULT_MOCK_CMS_SEED,
  cloneMockCmsSeed,
  type ManagerSession,
  type ManagerUser,
  type MockCoverageSnapshot,
  type MockCoverageStatus,
  type MockLanguageGeo,
  type MockVideoCoverage,
  type MockCmsSeed,
  type MockCmsState,
  type MockManagerUserRecord,
  verifyMockPassword,
} from "./mock-seed"
import {
  DEFAULT_MOCK_CMS_DATA_PATH,
  createMockCmsStore,
  type MockCmsStore,
} from "./mock-store"
import {
  AdminGraphqlClient,
  type AdminVideoForEnrichment,
  type CoverageSnapshotQuery,
} from "@/backend/admin-client"

export type { ManagerSession, ManagerUser } from "./mock-seed"

export type CmsGatewayMode = "admin" | "live" | "mock"

export type CmsGatewayAuthHandlers = {
  loginManagerUser?: (
    email: string,
    password: string,
  ) => Promise<ManagerSession | null> | ManagerSession | null
  verifyManagerSession?: (
    token: string,
  ) => Promise<ManagerUser | null> | ManagerUser | null
}

export type CmsGatewayOptions = {
  mode?: CmsGatewayMode
  mockSecret?: string
  mockDataPath?: string
  mockSeed?: MockCmsSeed
  mockStore?: MockCmsStore
  liveAuth?: CmsGatewayAuthHandlers
}

export interface CmsGateway {
  readonly mode: CmsGatewayMode
  loginManagerUser(
    email: string,
    password: string,
  ): Promise<ManagerSession | null>
  verifyManagerSession(token: string): Promise<ManagerUser | null>
  readMockState?(): Promise<MockCmsState>
  updateMockState?(
    updater: (current: MockCmsState) => MockCmsState,
  ): Promise<MockCmsState>
  getLanguageGeo(): Promise<MockLanguageGeo>
  getVideoCoverage(languageIds?: string[]): Promise<MockVideoCoverage[]>
  getVideosForEnrichment(ids?: string[]): Promise<AdminVideoForEnrichment[]>
  getCoverageSnapshots(
    query?: CoverageSnapshotQuery,
  ): Promise<MockCoverageSnapshot[]>
}

type ManagerSessionPayload = {
  sub: number
  email: string
  roleName: string
  issuedAt: string
  version: 1
}

const SESSION_VERSION = 1
const SESSION_TYPE = "manager-session"
const DEFAULT_MOCK_SESSION_SECRET = "forge-manager-mock-secret"

let singletonGateway: CmsGateway | undefined
let registeredLiveAuthHandlers: CmsGatewayAuthHandlers = {}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8")
}

function signValue(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function countCoverageStatuses(
  statuses: MockCoverageStatus[],
): MockVideoCoverage["coverage"]["subtitles"] {
  return {
    human: statuses.filter((status) => status === "human").length,
    ai: statuses.filter((status) => status === "ai").length,
  }
}

function sanitizeManagerUser(user: MockManagerUserRecord): ManagerUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: cloneMockCmsSeed(user.role),
  }
}

function createSessionToken(
  secret: string,
  user: MockManagerUserRecord,
): string {
  const header = base64urlEncode(
    JSON.stringify({
      alg: "HS256",
      typ: SESSION_TYPE,
      version: SESSION_VERSION,
    }),
  )
  const payload = base64urlEncode(
    JSON.stringify({
      sub: user.id,
      email: normalizeEmail(user.email),
      roleName: user.role.name,
      issuedAt: new Date().toISOString(),
      version: SESSION_VERSION,
    } satisfies ManagerSessionPayload),
  )
  const unsignedToken = `${header}.${payload}`
  return `${unsignedToken}.${signValue(secret, unsignedToken)}`
}

function parseSessionToken(
  token: string,
  secret: string,
): ManagerSessionPayload | null {
  const parts = token.split(".")
  if (parts.length !== 3) {
    return null
  }

  const [header, payload, signature] = parts
  const expectedSignature = signValue(secret, `${header}.${payload}`)
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null
  }

  try {
    const decodedHeader = JSON.parse(base64urlDecode(header)) as {
      typ?: unknown
      version?: unknown
    }
    if (
      decodedHeader.typ !== SESSION_TYPE ||
      decodedHeader.version !== SESSION_VERSION
    ) {
      return null
    }

    const decodedPayload = JSON.parse(
      base64urlDecode(payload),
    ) as Partial<ManagerSessionPayload>
    if (
      typeof decodedPayload.sub !== "number" ||
      !Number.isInteger(decodedPayload.sub) ||
      decodedPayload.sub <= 0 ||
      typeof decodedPayload.email !== "string" ||
      decodedPayload.email.length === 0 ||
      typeof decodedPayload.roleName !== "string" ||
      decodedPayload.roleName.length === 0 ||
      typeof decodedPayload.issuedAt !== "string" ||
      decodedPayload.issuedAt.length === 0 ||
      decodedPayload.version !== SESSION_VERSION
    ) {
      return null
    }

    return {
      sub: decodedPayload.sub,
      email: decodedPayload.email,
      roleName: decodedPayload.roleName,
      issuedAt: decodedPayload.issuedAt,
      version: SESSION_VERSION,
    }
  } catch {
    return null
  }
}

function createLiveGateway(): CmsGateway {
  return {
    mode: "live",
    async loginManagerUser(email, password) {
      return (
        (await registeredLiveAuthHandlers.loginManagerUser?.(
          email,
          password,
        )) ?? null
      )
    },
    async verifyManagerSession(token) {
      return (
        (await registeredLiveAuthHandlers.verifyManagerSession?.(token)) ?? null
      )
    },
    async readMockState() {
      throw new Error("Live CMS gateway mock state is not available.")
    },
    async updateMockState() {
      throw new Error("Live CMS gateway mock state is not available.")
    },
    async getLanguageGeo() {
      throw new Error("Live CMS gateway language geo is not configured yet.")
    },
    async getVideoCoverage() {
      throw new Error("Live CMS gateway video coverage is not configured yet.")
    },
    async getVideosForEnrichment() {
      throw new Error(
        "Live CMS gateway enrichment video lookup is not configured yet.",
      )
    },
    async getCoverageSnapshots() {
      throw new Error(
        "Live CMS gateway coverage snapshots are not configured yet.",
      )
    },
  }
}

function createAdminGateway(): CmsGateway {
  const graphqlUrl = process.env.ADMIN_GRAPHQL_URL
  if (!graphqlUrl) {
    throw new Error("ADMIN_GRAPHQL_URL is required for Manager admin backend")
  }

  const client = new AdminGraphqlClient({
    graphqlUrl,
    apiKey: process.env.ADMIN_MANAGER_API_KEY,
  })

  return {
    mode: "admin",
    async loginManagerUser() {
      throw new Error("Manager OAuth login does not use the CMS gateway.")
    },
    async verifyManagerSession() {
      throw new Error(
        "Manager OAuth session validation does not use the CMS gateway.",
      )
    },
    async readMockState() {
      throw new Error("Admin Manager gateway mock state is not available.")
    },
    async updateMockState() {
      throw new Error("Admin Manager gateway mock state is not available.")
    },
    getLanguageGeo() {
      return client.getLanguageGeo()
    },
    getVideoCoverage(languageIds) {
      return client.getVideoCoverage(languageIds)
    },
    getVideosForEnrichment(ids) {
      return client.getVideosForEnrichment(ids)
    },
    getCoverageSnapshots(query) {
      return client.getCoverageSnapshots(query)
    },
  }
}

function createMockGateway(options: CmsGatewayOptions): CmsGateway {
  const secret =
    options.mockSecret ??
    process.env.MANAGER_MOCK_SESSION_SECRET ??
    DEFAULT_MOCK_SESSION_SECRET
  const store =
    options.mockStore ??
    createMockCmsStore({
      dataPath: options.mockDataPath ?? process.env.MANAGER_MOCK_DATA_PATH,
      seed: options.mockSeed ?? DEFAULT_MOCK_CMS_SEED,
    })

  return {
    mode: "mock",
    async loginManagerUser(email, password) {
      const user = await store.findUserByEmail(normalizeEmail(email))
      if (!user || user.role.name !== "Manager") {
        return null
      }

      if (!verifyMockPassword(password, user.passwordHash)) {
        return null
      }

      return {
        token: createSessionToken(secret, user),
        user: sanitizeManagerUser(user),
      }
    },
    async verifyManagerSession(token) {
      const payload = parseSessionToken(token, secret)
      if (!payload || payload.roleName !== "Manager") {
        return null
      }

      const user = await store.findUserById(payload.sub)
      if (!user || user.role.name !== "Manager") {
        return null
      }

      if (normalizeEmail(user.email) !== normalizeEmail(payload.email)) {
        return null
      }

      return sanitizeManagerUser(user)
    },
    async readMockState() {
      return store.readState()
    },
    async updateMockState(updater) {
      return store.updateState(updater)
    },
    async getLanguageGeo() {
      const state = await store.readState()
      return cloneMockCmsSeed(state.readModels.languageGeo)
    },
    async getVideoCoverage(languageIds = []) {
      const state = await store.readState()
      const selectedLanguageIds = new Set(
        languageIds.map((languageId) => languageId.trim()).filter(Boolean),
      )

      if (selectedLanguageIds.size === 0) {
        return cloneMockCmsSeed(state.readModels.videoCoverage)
      }

      return cloneMockCmsSeed(
        state.readModels.videoCoverage.map((video) => {
          const languageCoverage = video.languageCoverage
          if (!languageCoverage) {
            return video
          }

          const selectedSubtitles = [...selectedLanguageIds].map(
            (languageId) => languageCoverage[languageId]?.subtitles ?? "none",
          )
          const selectedAudio = [...selectedLanguageIds].map(
            (languageId) => languageCoverage[languageId]?.audio ?? "none",
          )

          return {
            ...video,
            coverage: {
              subtitles: countCoverageStatuses(selectedSubtitles),
              audio: countCoverageStatuses(selectedAudio),
            },
          }
        }),
      )
    },
    async getVideosForEnrichment(ids = []) {
      const state = await store.readState()
      const selectedIds = new Set(ids.map((id) => id.trim()).filter(Boolean))
      return state.readModels.videoCoverage
        .filter(
          (video) =>
            selectedIds.size === 0 ||
            selectedIds.has(video.documentId) ||
            (video.coreId != null && selectedIds.has(video.coreId)),
        )
        .map((video) => ({
          documentId: video.documentId,
          coreId: video.coreId,
          title: video.title ?? null,
          label: video.label ?? null,
          primaryLanguage: {
            coreId: "529",
            bcp47: "en",
            iso3: null,
          },
          variants: [
            {
              language: {
                coreId: "529",
                bcp47: "en",
                iso3: null,
              },
              muxVideo: {
                assetId: `mock-${video.coreId ?? video.documentId}-asset`,
                playbackId: `mock-${video.coreId ?? video.documentId}-playback`,
              },
              downloads: [],
            },
          ],
        }))
    },
    async getCoverageSnapshots(query) {
      const state = await store.readState()
      const snapshots = cloneMockCmsSeed(state.readModels.coverageSnapshots)
      if (!query) {
        return snapshots
      }
      if ("latest" in query) {
        return snapshots
          .slice()
          .sort((left, right) => right.date.localeCompare(left.date))
          .slice(0, 1)
      }
      return snapshots.filter(
        (snapshot) =>
          snapshot.date >= query.startDate && snapshot.date <= query.endDate,
      )
    },
  }
}

export function registerLiveCmsGatewayAuthHandlers(
  handlers: CmsGatewayAuthHandlers,
): void {
  registeredLiveAuthHandlers = { ...handlers }
}

export function resetCmsGatewayForTests(): void {
  singletonGateway = undefined
  registeredLiveAuthHandlers = {}
}

export function createCmsGateway(options: CmsGatewayOptions = {}): CmsGateway {
  const mode =
    options.mode ??
    readModeFromEnv(
      process.env.MANAGER_BACKEND_MODE ?? process.env.MANAGER_DATA_MODE,
    )
  if (mode === "mock") {
    return createMockGateway(options)
  }

  if (options.liveAuth) {
    registerLiveCmsGatewayAuthHandlers(options.liveAuth)
  }

  if (mode === "admin") {
    return createAdminGateway()
  }

  return createLiveGateway()
}

export function getCmsGateway(): CmsGateway {
  if (!singletonGateway) {
    singletonGateway = createCmsGateway({
      mode: readModeFromEnv(
        process.env.MANAGER_BACKEND_MODE ?? process.env.MANAGER_DATA_MODE,
      ),
      mockSecret: process.env.MANAGER_MOCK_SESSION_SECRET,
      mockDataPath:
        process.env.MANAGER_MOCK_DATA_PATH ?? DEFAULT_MOCK_CMS_DATA_PATH,
    })
  }

  return singletonGateway
}

export function readModeFromEnv(value: string | undefined): CmsGatewayMode {
  if (value === "mock") return "mock"
  if (value === "admin") return "admin"
  return "admin"
}

export async function readMockCmsState(
  gateway: CmsGateway,
): Promise<MockCmsState | null> {
  if (gateway.mode !== "mock") {
    return null
  }

  return gateway.readMockState?.() ?? null
}

export async function updateMockCmsState(
  gateway: CmsGateway,
  updater: (current: MockCmsState) => MockCmsState,
): Promise<MockCmsState | null> {
  if (gateway.mode !== "mock") {
    return null
  }

  return gateway.updateMockState?.(updater) ?? null
}
