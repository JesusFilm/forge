import { describe, expect, it } from "vitest"
import {
  getJobMuxEnvironment,
  getMuxEnvironmentTooltip,
} from "@/lib/mux-environment"
import type { JobArtifactManifest } from "@/types/job"

describe("getJobMuxEnvironment", () => {
  it("reads the stage target environment from materialization metadata", () => {
    const artifacts: JobArtifactManifest = {
      materialization: {
        kind: "metadata",
        data: {
          targetEnvironment: "mux-stage",
        },
      },
    }

    expect(getJobMuxEnvironment(artifacts)).toBe("staging")
  })

  it("falls back to snapshot clone mode for legacy stage jobs", () => {
    const artifacts: JobArtifactManifest = {
      materialization: {
        kind: "metadata",
        data: {
          mode: "snapshot_to_stage_clone",
        },
      },
    }

    expect(getJobMuxEnvironment(artifacts)).toBe("staging")
  })

  it("defaults to production when no stage metadata is present", () => {
    expect(getJobMuxEnvironment({})).toBe("production")
  })

  it("treats explicit production target metadata as production", () => {
    const artifacts: JobArtifactManifest = {
      materialization: {
        kind: "metadata",
        data: {
          targetEnvironment: "mux-production",
          mode: "direct_mux_asset_reuse",
        },
      },
    }

    expect(getJobMuxEnvironment(artifacts)).toBe("production")
  })
})

describe("getMuxEnvironmentTooltip", () => {
  it("returns the staging tooltip copy", () => {
    expect(getMuxEnvironmentTooltip("staging")).toBe("Staging Mux environment")
  })

  it("returns the production tooltip copy", () => {
    expect(getMuxEnvironmentTooltip("production")).toBe(
      "Production Mux environment",
    )
  })
})
