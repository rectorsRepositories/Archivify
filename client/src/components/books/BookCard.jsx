import { BookOpen, Download } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/** @param {{book: object}} props Indexed book and its format URLs. @returns {import('react').ReactElement} Cover card with reading and download actions. */
export default function BookCard({ book }) {
  const [failedCover, setFailedCover] = useState(null)
  const [selectedFormat, setSelectedFormat] = useState('')
  const format = book.formats.find((item) => item.format === selectedFormat) || book.formats[0]
  const coverAvailable = book.artwork_url && failedCover !== book.artwork_url

  return (
    <article className="book-card">
      <div className="book-art-frame">
        {coverAvailable ? <img src={book.artwork_url} alt={`${book.title} cover`} loading="lazy" onError={() => setFailedCover(book.artwork_url)} /> : <div className="book-art-placeholder"><BookOpen size={42} aria-hidden="true" /><span>{book.title}</span></div>}
        <span className="book-format-badge">{book.formats.map((item) => item.format.toUpperCase()).join(' · ')}</span>
      </div>
      <div className="book-info">
        <h3 title={book.title}>{book.title}</h3>
        <p title={book.authors.join(', ')}>{book.authors.join(', ') || 'Unknown author'}</p>
        <div className="book-card-actions">
          {book.can_read ? <Link className="primary-button" to={`/books/${book.id}/read`} aria-label={`Read ${book.title}`}><BookOpen size={15} /> Read</Link> : <button type="button" className="secondary-button" disabled title={book.metadata_status === 'error' ? 'This EPUB could not be indexed for reading.' : 'An EPUB is needed to read this book.'}><BookOpen size={15} /> Read</button>}
          {format && <a className="secondary-button book-download" href={format.download_url} aria-label={`Download ${book.title} as ${format.format.toUpperCase()}`}><Download size={15} /><span>Download</span></a>}
        </div>
        {book.formats.length > 1 && <label className="book-format-select"><span>Download format</span><select value={format.format} onChange={(event) => setSelectedFormat(event.target.value)} aria-label={`Download format for ${book.title}`}>{book.formats.map((item) => <option key={item.format} value={item.format}>{item.format.toUpperCase()}</option>)}</select></label>}
      </div>
    </article>
  )
}
