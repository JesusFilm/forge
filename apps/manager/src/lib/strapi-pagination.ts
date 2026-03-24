// Shared pagination helper for Strapi GraphQL _connection queries.

export type PageInfo = {
  page: number
  pageCount: number
  pageSize: number
  total: number
}

export const DEFAULT_PAGE_INFO: PageInfo = {
  page: 1,
  pageCount: 1,
  pageSize: 5000,
  total: 0,
}

export async function fetchAllPages<T>(
  fetcher: (page: number) => Promise<{ nodes: T[]; pageInfo: PageInfo }>,
): Promise<T[]> {
  const allNodes: T[] = []
  let currentPage = 1

  while (true) {
    const result = await fetcher(currentPage)
    allNodes.push(...result.nodes)
    if (currentPage >= result.pageInfo.pageCount) break
    currentPage += 1
  }

  return allNodes
}
