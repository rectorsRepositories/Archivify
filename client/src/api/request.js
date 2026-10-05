export async function request(path, { signal } = {}) {
  const response = await fetch(path, { signal })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(body?.error?.message || `Archive request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

export function withQuery(path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  return query.size ? `${path}?${query}` : path
}

export async function allPages(path, { signal } = {}) {
  const items = []
  while (true) {
    const page = await request(withQuery(path, { limit: 100, offset: items.length }), { signal })
    items.push(...page.data)
    if (items.length >= page.pagination.total || page.data.length === 0) return items
  }
}
