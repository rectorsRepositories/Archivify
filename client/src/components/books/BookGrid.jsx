import BookCard from './BookCard.jsx'

/** @param {{books: object[], compact?: boolean}} props Indexed books and shelf layout. @returns {import('react').ReactElement} Responsive book collection. */
export default function BookGrid({ books, compact = false }) {
  return <div className={`book-grid${compact ? ' compact-grid' : ''}`}>{books.map((book) => <BookCard key={book.id} book={book} />)}</div>
}
