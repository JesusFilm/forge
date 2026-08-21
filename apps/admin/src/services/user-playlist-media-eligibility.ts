import type { PrismaClient } from "@prisma/client"
import type {
  UserPlaylistMediaEligibility,
  VerifiedViewerCountryContext,
} from "./user-playlist.service"

/**
 * Conservative default for U3. It attests only catalog-wide Watch visibility
 * and playable published audio. Country is accepted only as an already
 * integrity-verified context and is deliberately not treated as an
 * entitlement source until a canonical territory policy exists.
 */
export class PrismaUserPlaylistMediaEligibility implements UserPlaylistMediaEligibility {
  constructor(private readonly prisma: PrismaClient) {}

  async eligibleVideoIds(input: {
    videoIds: readonly string[]
    viewerCountry: VerifiedViewerCountryContext | null
  }): Promise<ReadonlySet<string>> {
    const videoIds = [...new Set(input.videoIds)]
    if (videoIds.length === 0) return new Set()
    void input.viewerCountry

    const rows = await this.prisma.video.findMany({
      where: {
        id: { in: videoIds },
        deletedAt: null,
        noIndex: false,
        NOT: { restrictViewPlatforms: { has: "watch" } },
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
        dubs: {
          some: {
            deletedAt: null,
            published: true,
            AND: [{ hls: { not: null } }, { hls: { not: "" } }],
            OR: [
              { videoEditionId: null },
              { videoEdition: { deletedAt: null } },
            ],
          },
        },
      },
      select: { id: true },
    })
    return new Set(rows.map((row) => row.id))
  }
}
