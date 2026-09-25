async function request(path) {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`)
  return response.json()
}

// Prepared for the archive API. The UI uses local mock data until these endpoints are ready.
export const getAlbums = () => request('/api/music/albums')
export const getAlbum = (id) => request(`/api/music/albums/${encodeURIComponent(id)}`)
export const getAlbumTracks = (id) => request(`/api/music/albums/${encodeURIComponent(id)}/tracks`)
