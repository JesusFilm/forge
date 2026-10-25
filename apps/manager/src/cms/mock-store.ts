import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  DEFAULT_MOCK_ARTIFACT_FILES,
  DEFAULT_MOCK_CMS_SEED,
  cloneMockCmsSeed,
  type MockArtifactFile,
  type MockCmsSeed,
  type MockCmsState,
  type MockManagerUserRecord,
} from "./mock-seed"

export type MockCmsStoreOptions = {
  dataPath?: string
  seed?: MockCmsSeed
}

export const DEFAULT_MOCK_CMS_DATA_PATH = join(
  process.cwd(),
  ".tmp",
  "mock-cms",
  "store.json",
)

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function persistState(dataPath: string, state: MockCmsState) {
  await mkdir(dirname(dataPath), { recursive: true })
  await writeFile(dataPath, JSON.stringify(state, null, 2))
}

async function materializeMockArtifacts(files: MockArtifactFile[]) {
  for (const file of files) {
    const artifactPath = join(
      process.cwd(),
      ".tmp",
      "artifacts",
      file.assetId,
      `${file.artifactType}.${file.ext}`,
    )
    await mkdir(dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, file.body)
  }
}

export class MockCmsStore {
  readonly dataPath: string
  readonly seed: MockCmsSeed

  private statePromise: Promise<MockCmsState> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: MockCmsStoreOptions = {}) {
    this.dataPath = options.dataPath ?? DEFAULT_MOCK_CMS_DATA_PATH
    this.seed = cloneMockCmsSeed(options.seed ?? DEFAULT_MOCK_CMS_SEED)
  }

  private async ensureState(): Promise<MockCmsState> {
    if (!this.statePromise) {
      this.statePromise = (async () => {
        try {
          const existing = await readFile(this.dataPath, "utf8")
          await materializeMockArtifacts(DEFAULT_MOCK_ARTIFACT_FILES)
          return cloneMockCmsSeed(JSON.parse(existing) as MockCmsState)
        } catch {
          const initialState = cloneMockCmsSeed(this.seed)
          await persistState(this.dataPath, initialState)
          await materializeMockArtifacts(DEFAULT_MOCK_ARTIFACT_FILES)
          return initialState
        }
      })()
    }

    return this.statePromise
  }

  async readState(): Promise<MockCmsState> {
    return cloneMockCmsSeed(await this.ensureState())
  }

  async reset(): Promise<MockCmsState> {
    const nextState = cloneMockCmsSeed(this.seed)
    this.statePromise = Promise.resolve(nextState)
    await this.queuePersist(nextState)
    return cloneMockCmsSeed(nextState)
  }

  async replaceState(nextState: MockCmsState): Promise<MockCmsState> {
    const cloned = cloneMockCmsSeed(nextState)
    this.statePromise = Promise.resolve(cloned)
    await this.queuePersist(cloned)
    return cloneMockCmsSeed(cloned)
  }

  async updateState(
    updater: (current: MockCmsState) => MockCmsState,
  ): Promise<MockCmsState> {
    const current = await this.ensureState()
    const nextState = cloneMockCmsSeed(updater(cloneMockCmsSeed(current)))
    this.statePromise = Promise.resolve(nextState)
    await this.queuePersist(nextState)
    return cloneMockCmsSeed(nextState)
  }

  async findUserByEmail(email: string): Promise<MockManagerUserRecord | null> {
    const normalizedEmail = normalizeEmail(email)
    const state = await this.ensureState()
    const user =
      state.users.find(
        (entry) => normalizeEmail(entry.email) === normalizedEmail,
      ) ?? null
    return user ? cloneMockCmsSeed(user) : null
  }

  async findUserById(id: number): Promise<MockManagerUserRecord | null> {
    const state = await this.ensureState()
    const user = state.users.find((entry) => entry.id === id) ?? null
    return user ? cloneMockCmsSeed(user) : null
  }

  private async queuePersist(state: MockCmsState): Promise<void> {
    this.writeChain = this.writeChain.then(() =>
      persistState(this.dataPath, state),
    )
    await this.writeChain
  }
}

export function createMockCmsStore(
  options?: MockCmsStoreOptions,
): MockCmsStore {
  return new MockCmsStore(options)
}
