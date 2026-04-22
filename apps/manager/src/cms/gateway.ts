import { createHmac, timingSafeEqual } from "node:crypto"
import {
  DEFAULT_MOCK_CMS_SEED,
  cloneMockCmsSeed,
  type ManagerSession,
  type ManagerUser,
  type MockCoverageSnapshot,
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

export type { ManagerSession, ManagerUser } from "./mock-seed"

export type CmsGatewayMode = "live" | "mock"

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
  getCoverageSnapshots(): Promise<MockCoverageSnapshot[]>
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
    async getCoverageSnapshots() {
      throw new Error(
        "Live CMS gateway coverage snapshots are not configured yet.",
      )
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

      const knownLanguageIds = new Set(
        state.readModels.languageGeo.languages.map((language) => language.id),
      )
      if (
        [...selectedLanguageIds].some(
          (languageId) => !knownLanguageIds.has(languageId),
        )
      ) {
        return []
      }

      return cloneMockCmsSeed(state.readModels.videoCoverage)
    },
    async getCoverageSnapshots() {
      const state = await store.readState()
      return cloneMockCmsSeed(state.readModels.coverageSnapshots)
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
  const mode = options.mode ?? readModeFromEnv(process.env.MANAGER_DATA_MODE)
  if (mode === "mock") {
    return createMockGateway(options)
  }

  if (options.liveAuth) {
    registerLiveCmsGatewayAuthHandlers(options.liveAuth)
  }

  return createLiveGateway()
}

export function getCmsGateway(): CmsGateway {
  if (!singletonGateway) {
    singletonGateway = createCmsGateway({
      mode: readModeFromEnv(process.env.MANAGER_DATA_MODE),
      mockSecret: process.env.MANAGER_MOCK_SESSION_SECRET,
      mockDataPath:
        process.env.MANAGER_MOCK_DATA_PATH ?? DEFAULT_MOCK_CMS_DATA_PATH,
    })
  }

  return singletonGateway
}

export function readModeFromEnv(value: string | undefined): CmsGatewayMode {
  return value === "mock" ? "mock" : "live"
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
