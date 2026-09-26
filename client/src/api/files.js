export async function getFiles(path = '') {
  const params = new URLSearchParams({ path })
  const response = await fetch(`/api/v1/files?${params}`)
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`)
  return response.json()
}
