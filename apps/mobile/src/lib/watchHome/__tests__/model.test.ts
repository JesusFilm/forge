import { buildVideoByCoreIdIndex, type WatchHomeVideoInput } from "../model"

describe("buildVideoByCoreIdIndex", () => {
  it("indexes top-level videos by coreId", () => {
    const videos: WatchHomeVideoInput[] = [
      { documentId: "d1", coreId: "1_jf-0-0", slug: "jesus" },
      { documentId: "d2", coreId: "6_Acts0401", slug: "lumo-acts-1-1-8-3" },
    ]
    const index = buildVideoByCoreIdIndex(videos)
    expect(index.get("1_jf-0-0")?.slug).toBe("jesus")
    expect(index.get("6_Acts0401")?.slug).toBe("lumo-acts-1-1-8-3")
  })

  it("indexes children[].child by coreId so an item that lives only as a child hydrates", () => {
    const videos: WatchHomeVideoInput[] = [
      {
        documentId: "coll",
        coreId: "GOLukeCollection",
        slug: "lumo-the-gospel-of-luke",
        children: [
          {
            child: {
              documentId: "ep1",
              coreId: "3_Luke0101",
              slug: "luke-1",
            },
          },
        ],
      },
    ]
    const index = buildVideoByCoreIdIndex(videos)
    expect(index.get("GOLukeCollection")?.slug).toBe("lumo-the-gospel-of-luke")
    expect(index.get("3_Luke0101")?.slug).toBe("luke-1")
  })

  it("on a coreId present both as a child and a top-level record, the top-level record wins", () => {
    const videos: WatchHomeVideoInput[] = [
      {
        documentId: "coll",
        coreId: "coll",
        children: [
          { child: { documentId: "dup", coreId: "dup", slug: "as-child" } },
        ],
      },
      { documentId: "dup", coreId: "dup", slug: "as-top-level" },
    ]
    const index = buildVideoByCoreIdIndex(videos)
    expect(index.get("dup")?.slug).toBe("as-top-level")
  })

  it("skips records without a coreId", () => {
    const videos: WatchHomeVideoInput[] = [
      { documentId: "d1", coreId: null, slug: "no-core" },
      { documentId: "d2", coreId: "", slug: "empty-core" },
    ]
    expect(buildVideoByCoreIdIndex(videos).size).toBe(0)
  })
})
