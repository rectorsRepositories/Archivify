async function request(path, { signal } = {}) {
  const response = await fetch(path, { signal })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(body?.error?.message || `Archive request failed (${response.status})`)
    error.status = response.status
    throw error
  }

  return body
}

async function allPages(path, { signal } = {}) {
  const items = []
  const url = new URL(path, window.location.origin)
  url.searchParams.set('limit', '100')

  while (true) {
    url.searchParams.set('offset', String(items.length))
    const page = await request(`${url.pathname}${url.search}`, { signal })
    items.push(...page.data)
    if (items.length >= page.pagination.total || page.data.length === 0) return items
  }
}

export const getAlbums = (options) => allPages('/api/v1/music/albums', options)
export const getAlbum = async (id, options) => (await request(`/api/v1/music/albums/${encodeURIComponent(id)}`, options)).data
export const getAlbumTracks = (id, options) => allPages(`/api/v1/music/albums/${encodeURIComponent(id)}/tracks`, options)
export const getLibrarySummary = async (options) => (await request('/api/v1/library/summary', options)).data
