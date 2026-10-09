import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBook } from '../api/books.js'
import useEpubReader from '../hooks/useEpubReader.js'
import { readSettings, saveSettings } from '../books/readerState.mjs'

/** @param {{book: object}} props Readable book metadata. @returns {import('react').ReactElement} EPUB viewport and accessible reader controls. */
function ReadingPane({ book }) {
  const viewportRef = useRef(null)
  const [settings, setSettings] = useState(() => {
    try { return readSettings(window.localStorage) } catch { return { theme: 'paper', fontSize: 100 } }
  })
  const reader = useEpubReader(book, viewportRef, settings)
  const [chapterChoice, setChapterChoice] = useState('')
  useEffect(() => { try { saveSettings(window.localStorage, settings) } catch { /* Reading remains available. */ } }, [settings])
  useEffect(() => {
    const section = reader.section.split('#')[0]
    setChapterChoice((current) => current.split('#')[0] === section ? current : reader.chapters.find((chapter) => chapter.href.split('#')[0] === section)?.href || '')
  }, [reader.section, reader.chapters])

  return (
    <section className={`book-reader reader-${settings.theme}`} aria-label={`Read ${book.title}`}>
      <div className="reader-heading"><div><span className="eyebrow">NOW READING</span><h1>{book.title}</h1><p>{book.authors.join(', ') || 'Unknown author'}</p></div><a className="secondary-button" href={book.download_url} aria-label={`Download ${book.title}`}><Download size={16} /><span>Download</span></a></div>
      <div className="reader-toolbar">
        <label className="reader-chapters"><span>Chapter</span><select aria-label="Go to chapter" value={chapterChoice} disabled={!reader.ready || reader.busy} onChange={(event) => { setChapterChoice(event.target.value); reader.display(event.target.value) }}><option value="" disabled>{reader.loading ? 'Loading chapters…' : 'Choose a chapter'}</option>{reader.chapters.map((chapter, index) => <option key={`${chapter.href}:${index}`} value={chapter.href}>{chapter.label}</option>)}</select></label>
        <label><span>Text size</span><select aria-label="Text size" value={settings.fontSize} onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))}>{[80, 90, 100, 110, 120, 140, 160].map((size) => <option key={size} value={size}>{size}%</option>)}</select></label>
        <label><span>Theme</span><select aria-label="Reading theme" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value }))}><option value="paper">Paper</option><option value="sepia">Sepia</option><option value="night">Night</option></select></label>
        <button type="button" className="reader-restart" onClick={reader.restart} disabled={!reader.ready || reader.busy} aria-label="Read from the beginning" title="Read from the beginning"><RotateCcw size={17} /></button>
      </div>
      <div className="reader-surface" aria-busy={reader.loading}>
        <div ref={viewportRef} className="epub-viewport" aria-label="Book content" />
        {reader.loading && <div className="reader-loading" role="status"><BookOpen size={32} /><span>Opening your book…</span></div>}
      </div>
      {reader.error && <div className="reader-error" role="alert"><p>{reader.error}</p><button type="button" className="secondary-button" onClick={reader.retry}>Try again</button></div>}
      <footer className="reader-footer"><button type="button" className="secondary-button" onClick={reader.previous} disabled={!reader.ready || reader.busy || reader.atStart}><ChevronLeft size={17} /> Previous</button><div aria-live="polite"><span>{reader.page ? `Page ${reader.page} of ${reader.pages} in this section` : 'Your reading space'}</span><small>{reader.positionSaved ? 'Reading position saved on this device' : reader.ready ? 'Reading position could not be saved on this device' : 'Arrow keys also turn pages'}</small></div><button type="button" className="secondary-button" onClick={reader.next} disabled={!reader.ready || reader.busy || reader.atEnd}>Next <ChevronRight size={17} /></button></footer>
    </section>
  )
}

/** @returns {import('react').ReactElement} Book loader, availability/error handling, and the reader. */
export default function BookReader() {
  const { id } = useParams()
  const [book, setBook] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBook(null)
    setError('')
    getBook(id, { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setBook(value) }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.status === 404 ? 'This book could not be found.' : cause.message)
    })
    return () => controller.abort()
  }, [id, attempt])

  return (
    <div className="reader-page page-stack">
      <Link className="reader-back" to="/books"><ArrowLeft size={16} /> Back to books</Link>
      {error ? <div className="empty-state" role="alert"><BookOpen size={35} /><h1>Could not open book</h1><p>{error}</p><button type="button" className="secondary-button" onClick={() => setAttempt((count) => count + 1)}>Try again</button></div> : !book ? <div className="empty-state" role="status">Loading book…</div> : !book.can_read ? <div className="empty-state"><BookOpen size={35} /><h1>{book.title}</h1><p>{book.metadata_status === 'error' ? 'This EPUB is currently unavailable for reading.' : 'An EPUB edition is needed to read this book here.'}</p>{book.download_url && <a className="secondary-button" href={book.download_url}><Download size={16} /> Download book</a>}</div> : <ReadingPane key={book.id} book={book} />}
    </div>
  )
}
