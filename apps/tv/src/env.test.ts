/**
 * Verifies the Metro-inlining defenses in env.ts behave correctly under
 * the conditions an EAS Update push relies on. The defenses themselves
 * (top-level `_inlined` const, try/catch with inlined values surfaced in
 * the error, and the CI && !EAS_BUILD skipValidation guard) live in
 * env.ts; these tests prove they actually work, not just that they exist.
 *
 * Each test uses jest.isolateModules so env.ts is re-evaluated with the
 * intended process.env state — env.ts validates at module-load, not at
 * function-call time, so cached imports would lock in stale state.
 */

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe("env", () => {
  describe("happy path", () => {
    it("returns EXPO_PUBLIC_GRAPHQL_URL when set to a valid URL", () => {
      process.env.EXPO_PUBLIC_GRAPHQL_URL = "https://api.example.com/graphql"
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { env } = require("./env") as {
          env: { EXPO_PUBLIC_GRAPHQL_URL: string }
        }
        expect(env.EXPO_PUBLIC_GRAPHQL_URL).toBe(
          "https://api.example.com/graphql",
        )
      })
    })

    it("returns EXPO_PUBLIC_STRAPI_TOKEN when set", () => {
      process.env.EXPO_PUBLIC_GRAPHQL_URL = "https://api.example.com/graphql"
      process.env.EXPO_PUBLIC_STRAPI_TOKEN = "test-token"
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { env } = require("./env") as {
          env: { EXPO_PUBLIC_STRAPI_TOKEN?: string }
        }
        expect(env.EXPO_PUBLIC_STRAPI_TOKEN).toBe("test-token")
      })
    })
  })

  describe("CI guard for skipValidation", () => {
    it("skips validation when CI is set and EAS_BUILD is unset", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      process.env.CI = "1"
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require("./env")).not.toThrow()
      })
    })

    it("does NOT skip validation when both CI and EAS_BUILD are set (real EAS Build env)", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      process.env.CI = "1"
      process.env.EAS_BUILD = "1"

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require("./env")).toThrow()
      })
    })

    it("does NOT skip validation when neither CI nor EAS_BUILD is set (local dev / runtime)", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require("./env")).toThrow()
      })
    })
  })

  describe("error message surfaces inlined values (Metro inlining defense)", () => {
    it("includes the inlined URL marker in the thrown error when validation fails", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        let captured: unknown
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("./env")
        } catch (e) {
          captured = e
        }
        expect(captured).toBeInstanceOf(Error)
        const message = (captured as Error).message
        expect(message).toMatch(/Inlined: URL=/)
        expect(message).toMatch(/TOKEN=/)
      })
    })

    it("reports TOKEN=MISSING when STRAPI_TOKEN is unset", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      delete process.env.EXPO_PUBLIC_STRAPI_TOKEN
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        let captured: unknown
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("./env")
        } catch (e) {
          captured = e
        }
        expect((captured as Error).message).toMatch(/TOKEN=MISSING/)
      })
    })

    it("reports TOKEN=set when STRAPI_TOKEN is set but URL fails validation", () => {
      delete process.env.EXPO_PUBLIC_GRAPHQL_URL
      process.env.EXPO_PUBLIC_STRAPI_TOKEN = "some-token"
      delete process.env.CI
      delete process.env.EAS_BUILD

      jest.isolateModules(() => {
        let captured: unknown
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("./env")
        } catch (e) {
          captured = e
        }
        expect((captured as Error).message).toMatch(/TOKEN=set/)
      })
    })
  })
})
