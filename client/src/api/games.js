export async function getGames() {
  const response = await fetch('/api/games')
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`)
  return response.json()
}
