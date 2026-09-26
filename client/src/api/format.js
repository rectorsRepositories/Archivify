export function artistNames(artists) {
  return artists?.length ? artists.map((artist) => artist.name).join(', ') : 'Unknown artist'
}

export function formatBytes(bytes) {
  if (bytes == null) return 'Size unknown'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatDuration(milliseconds) {
  if (milliseconds == null) return '—'
  const seconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
