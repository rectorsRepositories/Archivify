const SETTINGS_KEY = 'home-archive:reader:settings'
const DEFAULT_SETTINGS = { theme: 'paper', fontSize: 100 }

/**
 * Identify a reading position by edition and EPUB revision, independent of metadata retagging.
 * @param {{id: number, formats: object[]}} book Book and format metadata.
 * @returns {string} Namespaced local-storage key.
 */
export function progressKey(book) {
  const file = book.formats.find((item) => item.format === 'epub')
  return `home-archive:reader:${book.id}:${file?.file_id}:${file?.size_bytes}:${file?.modified_at ?? ''}`
}

/** @param {Storage} storage Browser storage. @param {string} key Revision-specific key. @returns {string|undefined} Validated CFI or no saved position. */
export function readProgress(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key))
    return typeof value?.cfi === 'string' && value.cfi.startsWith('epubcfi(') && value.cfi.length <= 8000 ? value.cfi : undefined
  } catch { return undefined }
}

/** @param {Storage} storage Browser storage. @param {string} key Revision-specific key. @param {string} cfi EPUB location. @returns {boolean} Whether the position was persisted. */
export function saveProgress(storage, key, cfi) {
  try { storage.setItem(key, JSON.stringify({ cfi, updated_at: Date.now() })); return true } catch { return false }
}

/** @param {Storage} storage Browser storage. @returns {{theme: string, fontSize: number}} Validated preferences with defaults for unavailable storage. */
export function readSettings(storage) {
  try {
    const value = JSON.parse(storage.getItem(SETTINGS_KEY))
    return { theme: ['paper', 'sepia', 'night'].includes(value?.theme) ? value.theme : DEFAULT_SETTINGS.theme,
      fontSize: [80, 90, 100, 110, 120, 140, 160].includes(value?.fontSize) ? value.fontSize : DEFAULT_SETTINGS.fontSize }
  } catch { return { ...DEFAULT_SETTINGS } }
}

/** @param {Storage} storage Browser storage. @param {{theme: string, fontSize: number}} settings Reader preferences. @returns {void} */
export function saveSettings(storage, settings) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* Preferences are optional. */ }
}

/**
 * Flatten nested chapter navigation for an accessible native select, bounding recursion.
 * @param {object[]} items EPUB table of contents.
 * @param {number} [depth=0] Current nesting depth.
 * @returns {{href: string, label: string}[]} Chapter choices with indentation.
 */
export function chapterOptions(items, depth = 0) {
  if (depth > 20 || !Array.isArray(items)) return []
  return items.flatMap((item) => [
    ...(typeof item?.href === 'string' && item.href.trim() && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(item.href.trim()) ? [{ href: item.href.trim(), label: `${'— '.repeat(depth)}${typeof item.label === 'string' && item.label.trim() || 'Untitled chapter'}` }] : []),
    ...chapterOptions(item?.subitems, depth + 1),
  ])
}
