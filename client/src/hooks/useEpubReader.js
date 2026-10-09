import { useEffect, useRef, useState } from 'react'
import { chapterOptions, progressKey, readProgress, saveProgress } from '../books/readerState.mjs'

const themes = {
  paper: { background: '#fffdf6', color: '#30271f', link: '#8b3c17' },
  sepia: { background: '#f3e6c8', color: '#453323', link: '#873c1a' },
  night: { background: '#211e1c', color: '#e9dfd0', link: '#ffc185' },
}

/** @param {object} rendition EPUB rendition. @param {{theme: string, fontSize: number}} settings Preferences. @returns {void} */
function applySettings(rendition, settings) {
  const theme = themes[settings.theme] || themes.paper
  rendition.themes.register('archive', {
    body: { background: `${theme.background} !important`, color: `${theme.color} !important`, 'line-height': '1.65 !important' },
    'p, li, h1, h2, h3, h4, h5, h6': { color: 'inherit !important' },
    a: { color: `${theme.link} !important` },
    'img, svg': { 'max-width': '100% !important' },
  })
  rendition.themes.select('archive')
  rendition.themes.fontSize(`${settings.fontSize}%`)
}

/**
 * Own the EPUB renderer's fetch, lifecycle, navigation, and revision-specific progress.
 * The library and sanitizer load only when entering a readable book.
 * @param {object} book Indexed book with an inline EPUB URL.
 * @param {import('react').RefObject<HTMLElement>} viewportRef Mounted reading surface.
 * @param {{theme: string, fontSize: number}} settings Reader preferences.
 * @returns {object} Loading/error state, chapter/page metadata, and reader actions.
 */
export default function useEpubReader(book, viewportRef, settings) {
  const renditionRef = useRef(null)
  const settingsRef = useRef(settings)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true, error: '', ready: false, chapters: [], section: '', page: 0, pages: 0, atStart: true, atEnd: false, busy: false })
  const key = progressKey(book)
  settingsRef.current = settings

  useEffect(() => {
    const controller = new AbortController()
    let publication
    let rendition
    let observer
    let resizeFrame
    let currentCfi
    let navigating = false
    let ready = false
    let opening = true
    const viewport = viewportRef.current
    setState({ loading: true, error: '', ready: false, chapters: [], section: '', page: 0, pages: 0, atStart: true, atEnd: false, busy: false })

    const showError = () => {
      if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: 'This EPUB could not be opened. Try again or download a copy.', busy: false }))
    }
    const navigate = async (direction) => {
      if (!ready || navigating || controller.signal.aborted) return
      navigating = true
      setState((current) => ({ ...current, busy: true, error: '' }))
      try { await rendition[direction]() } catch { showError() }
      finally { navigating = false; if (!controller.signal.aborted) setState((current) => ({ ...current, busy: false })) }
    }
    const onKey = (event) => {
      const tag = event.target?.tagName?.toLowerCase()
      if (!ready || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ['input', 'select', 'textarea', 'button', 'a'].includes(tag) || event.target?.isContentEditable) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const rtl = publication?.package?.metadata?.direction === 'rtl'
        navigate((event.key === 'ArrowRight') !== rtl ? 'next' : 'prev')
      }
    }
    document.addEventListener('keydown', onKey)

    async function openBook() {
      try {
        const response = await fetch(book.content_url, { signal: controller.signal })
        if (!response.ok) throw new Error('EPUB request failed.')
        const bytes = await response.arrayBuffer()
        const [{ default: ePub }, { sanitizeChapter }] = await Promise.all([import('epubjs'), import('../books/sanitizeChapter.js')])
        if (controller.signal.aborted) return
        publication = ePub()
        await publication.open(bytes, 'binary')
        await publication.ready
        if (controller.signal.aborted) return
        publication.spine.hooks.content.register(sanitizeChapter)
        const navigation = await publication.loaded.navigation
        if (controller.signal.aborted) return
        let chapters = chapterOptions(navigation.toc)
        if (!chapters.length) chapters = publication.spine.spineItems.filter((item) => item.linear !== 'no').map((item, index) => ({ href: item.href, label: `Section ${index + 1}` }))
        rendition = publication.renderTo(viewport, { width: '100%', height: '100%', spread: 'none', flow: 'paginated', allowScriptedContent: false, allowPopups: false })
        renditionRef.current = rendition
        applySettings(rendition, settingsRef.current)
        rendition.on('displayError', showError)
        rendition.hooks.content.register((contents) => {
          contents.document.title = book.title
          contents.document.documentElement.setAttribute('aria-label', book.title)
          // EPUB.js forwards passive key events; use a cancellable listener for page turns.
          contents.document.addEventListener('keydown', onKey, { passive: false })
        })
        rendition.on('rendered', (_section, view) => view.iframe?.setAttribute('title', `${book.title} — reading area`))
        rendition.on('relocated', (location) => {
          if (controller.signal.aborted) return
          const start = location.start
          currentCfi = start.cfi
          let positionSaved = false
          try { positionSaved = saveProgress(window.localStorage, key, currentCfi) } catch { /* Storage access itself may be disabled. */ }
          setState((current) => ({ ...current, positionSaved, section: start.href, page: start.displayed.page, pages: start.displayed.total, atStart: location.atStart, atEnd: location.atEnd }))
        })
        let saved
        try { saved = readProgress(window.localStorage, key) } catch { /* Read without persistence. */ }
        try { await rendition.display(saved) } catch (error) {
          if (!saved) throw error
          await rendition.display() // Recover a stale or unsupported CFI.
        }
        if (controller.signal.aborted) return
        ready = true
        setState((current) => ({ ...current, chapters, ready: true, loading: false, error: '' }))
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame)
          resizeFrame = requestAnimationFrame(() => {
            if (!controller.signal.aborted && viewport.clientWidth && viewport.clientHeight) rendition.resize(viewport.clientWidth, viewport.clientHeight)
          })
        })
        observer.observe(viewport)
      } catch { showError() }
    }
    openBook().finally(() => {
      opening = false
      if (controller.signal.aborted) publication?.destroy()
    })
    return () => {
      controller.abort()
      document.removeEventListener('keydown', onKey)
      observer?.disconnect()
      cancelAnimationFrame(resizeFrame)
      renditionRef.current = null
      if (currentCfi) { try { saveProgress(window.localStorage, key, currentCfi) } catch { /* Optional persistence. */ } }
      // Book owns its rendition. Let an in-flight open settle before releasing it.
      if (!opening) publication?.destroy()
      viewport.replaceChildren()
    }
  }, [book.id, book.content_url, key, attempt, viewportRef])

  useEffect(() => {
    if (renditionRef.current) applySettings(renditionRef.current, settings)
  }, [settings.theme, settings.fontSize])

  async function move(target) {
    const rendition = renditionRef.current
    if (!rendition || state.busy || !state.ready) return
    setState((current) => ({ ...current, busy: true, error: '' }))
    try {
      if (target === 'next' || target === 'prev') await rendition[target]()
      else await rendition.display(target)
    } catch { if (renditionRef.current === rendition) setState((current) => ({ ...current, error: 'Could not move to that page. Try another chapter or reopen the book.' })) }
    finally { if (renditionRef.current === rendition) setState((current) => ({ ...current, busy: false })) }
  }

  return { ...state, next: () => move('next'), previous: () => move('prev'), display: move, restart: () => move(undefined), retry: () => setAttempt((count) => count + 1) }
}
