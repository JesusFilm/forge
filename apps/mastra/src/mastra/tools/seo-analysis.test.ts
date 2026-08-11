import { describe, expect, it } from "vitest"

import { toAdminSeoProposal } from "../../services/admin-seo-client"
import {
  digestSeoValue,
  seoPersistenceProposalPayload,
} from "../../services/seo-digest"
import { analyzeSeoEvidence } from "./seo-analysis"

const digest = "a".repeat(64)
const target = {
  targetId: "video-locale-1",
  targetType: "watch" as const,
  canonicalUrl: "https://example.com/watch/video/english.html",
  locale: "en",
  baseHash: digest,
  canonicalIdentityDigest: "b".repeat(64),
  preChangeSnapshot: {
    v: 1 as const,
    data: { id: "video-locale-1", title: "Hope", description: "Description" },
  },
  supportedFields: ["title", "description"],
  currentSnapshot: { title: "Hope", description: "Description", headings: [] },
}

describe("SEO evidence analysis", () => {
  it("turns retained high-impression low-CTR GSC evidence into an exact editorial diff", () => {
    const result = analyzeSeoEvidence({
      targets: [target],
      observations: [
        {
          id: "gsc-1",
          provider: "gsc",
          status: "available",
          retrievedAt: "2026-08-01T00:00:00.000Z",
          scope: {},
          data: {
            dimensions: ["page", "query"],
            rows: [
              {
                keys: [target.canonicalUrl, "stories of hope"],
                clicks: 5,
                impressions: 1_000,
                ctr: 0.005,
                position: 7,
              },
            ],
          },
          quality: { complete: true, truncated: false, caveats: [] },
          sources: [],
        },
      ],
      structuralFindings: [],
      maxProposals: 1,
    })
    expect(result.proposals).toHaveLength(1)
    const proposal = result.proposals[0]!
    expect(proposal.lane).toBe("editorial")
    if (proposal.lane !== "editorial") throw new Error("expected editorial")
    expect(proposal.fieldDiff).toEqual([
      {
        field: "title",
        before: "Hope",
        after: "Hope — Stories Of Hope",
      },
    ])
    const wire = toAdminSeoProposal(proposal, new Date("2026-08-01T00:00:00Z"))
    expect(wire.baseContentHash).toBe(digest)
    expect(wire.canonicalIdentityDigest).toBe("b".repeat(64))
    expect(wire.preChangeSnapshot).toEqual(target.preChangeSnapshot)
    expect(digestSeoValue(wire.payload)).toBe(wire.payloadDigest)
    expect(JSON.stringify(wire).toLowerCase()).not.toContain("meta keywords")
  })

  it("abstains when GSC evidence is absent", () => {
    expect(
      analyzeSeoEvidence({
        targets: [target],
        observations: [],
        structuralFindings: [],
      }).proposals,
    ).toEqual([])
  })

  it("hashes the same minimized payload that Admin persists", () => {
    const sensitiveTarget = {
      ...target,
      preChangeSnapshot: {
        ...target.preChangeSnapshot,
        data: {
          ...target.preChangeSnapshot.data,
          description:
            "Contact editor@example.com from 10.0.0.2 with token=private-value",
          sourceUrl:
            "http://editor:password@example.com/watch?token=private-value#private",
          blocks: [
            {
              type: "section",
              children: [
                {
                  type: "container",
                  content: {
                    nested: { one: { two: { three: "bounded" } } },
                  },
                },
              ],
            },
          ],
        },
      },
    }
    const proposal = analyzeSeoEvidence({
      targets: [sensitiveTarget],
      observations: [
        {
          id: "gsc-sensitive",
          provider: "gsc",
          status: "available",
          retrievedAt: "2026-08-01T00:00:00.000Z",
          scope: {},
          data: {
            dimensions: ["page", "query"],
            rows: [
              {
                keys: [target.canonicalUrl, "stories of hope"],
                clicks: 5,
                impressions: 1_000,
                ctr: 0.005,
                position: 7,
              },
            ],
          },
          quality: { complete: true, truncated: false, caveats: [] },
          sources: [],
        },
      ],
      structuralFindings: [],
      maxProposals: 1,
    }).proposals[0]!

    const wire = toAdminSeoProposal(proposal)
    expect(wire.payload).toEqual(seoPersistenceProposalPayload(proposal))
    expect(digestSeoValue(wire.payload)).toBe(wire.payloadDigest)
    expect(proposal.payloadDigest).toBe(wire.payloadDigest)
    expect(JSON.stringify(wire.payload)).not.toContain("editor@example.com")
    expect(JSON.stringify(wire.payload)).toContain('"description":')
    expect(JSON.stringify(wire.payload)).not.toContain("private-value")
    expect(JSON.stringify(wire.payload)).not.toContain("10.0.0.2")
    expect(JSON.stringify(wire.payload)).not.toContain("password")
    expect(JSON.stringify(wire.payload)).not.toContain("?token=")
    expect(JSON.stringify(wire.payload)).not.toContain("#private")
    expect(JSON.stringify(wire.payload)).toContain("[depth_limit]")
  })

  it("keeps aggregate proposal IDs stable when evidence content changes", () => {
    const analyze = (query: string, observationId: string) =>
      analyzeSeoEvidence({
        targets: [target],
        observations: [
          {
            id: observationId,
            provider: "gsc",
            status: "available",
            retrievedAt: "2026-08-01T00:00:00.000Z",
            scope: {},
            data: {
              dimensions: ["page", "query"],
              rows: [
                {
                  keys: [target.canonicalUrl, query],
                  clicks: 5,
                  impressions: 1_000,
                  ctr: 0.005,
                  position: 7,
                },
              ],
            },
            quality: { complete: true, truncated: false, caveats: [] },
            sources: [],
          },
        ],
        structuralFindings: [],
        maxProposals: 1,
      }).proposals[0]!

    const original = analyze("stories of hope", "gsc-1")
    const regenerated = analyze("watch jesus", "gsc-2")
    expect(regenerated.semanticConflictKey).toBe(original.semanticConflictKey)
    expect(regenerated.proposalId).toBe(original.proposalId)
    expect(regenerated.payloadDigest).not.toBe(original.payloadDigest)
  })
})
