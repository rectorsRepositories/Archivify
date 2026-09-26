export async function getGames({ signal } = {}) {
  const items = []
  while (true) {
    const response = await fetch(`/api/v1/games?limit=100&offset=${items.length}`, { signal })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error?.message || `Archive request failed (${response.status})`)
    items.push(...body.data)
    if (items.length >= body.pagination.total || body.data.length === 0) return items
  }
}
