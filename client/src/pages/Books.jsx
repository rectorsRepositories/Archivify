import { ArrowDownUp, BookOpen, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SearchBar from '../components/common/SearchBar.jsx'
import PagedFooter from '../components/common/PagedFooter.jsx'
import BookGrid from '../components/books/BookGrid.jsx'
import { getBookFacets, listBooks } from '../api/books.js'
import useDebouncedValue from '../hooks/useDebouncedValue.js'
import usePagedResults from '../hooks/usePagedResults.js'

const sorts = { title: 'Title A–Z', newest: 'Newest publication', oldest: 'Oldest publication', added: 'Recently added' }

/** @returns {import('react').ReactElement} Searchable book library with URL-persisted filters. */
export default function Books() {
  const [params, setParams] = useSearchParams()
  const [facets, setFacets] = useState({ authors: [], languages: [], subjects: [], years: [] })
  const [facetError, setFacetError] = useState('')
  const [facetRetry, setFacetRetry] = useState(0)
  const search = params.get('search') || ''
  const query = useDebouncedValue(search)
  const sort = Object.hasOwn(sorts, params.get('sort')) ? params.get('sort') : 'title'
  const format = ['epub', 'txt'].includes(params.get('format')) ? params.get('format') : ''
  const filters = { q: query.trim(), author: params.get('author') || '', language: params.get('language') || '', subject: params.get('subject') || '', format, sort }
  const results = usePagedResults(listBooks, filters)
  const isFiltered = Boolean(search || filters.author || filters.language || filters.subject || format)

  useEffect(() => {
    const controller = new AbortController()
    getBookFacets({ signal: controller.signal }).then(setFacets).catch((error) => {
      if (!controller.signal.aborted) setFacetError(error.message)
    })
    return () => controller.abort()
  }, [facetRetry])

  function updateFilter(name, value) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h1>Books library<span className="heading-dot">.</span></h1><p>A story for every shelf. Read here or take a copy with you.</p></div><div className="heading-stat"><BookOpen size={25} /><span><strong>{results.total} books</strong><small>{isFiltered ? 'Matching your filters' : 'Your indexed collection'}</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={(value) => updateFilter('search', value)} placeholder="Search titles, authors, and subjects..." label="Search books library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {results.items.length} of {results.total} shown</div></div>
      <div className="filter-row book-filters">
        <div className="filter-selects">
          {[['author', 'All authors', facets.authors], ['language', 'All languages', facets.languages], ['subject', 'All subjects', facets.subjects], ['format', 'All formats', ['epub', 'txt']]].map(([name, label, options]) => <label className="select-wrap" key={name}><span className="sr-only">Filter books by {name}</span><select value={filters[name]} onChange={(event) => updateFilter(name, event.target.value)}><option value="">{label}</option>{filters[name] && !options.includes(filters[name]) && <option>{filters[name]}</option>}{options.map((value) => <option key={value} value={value}>{name === 'format' ? value.toUpperCase() : value}</option>)}</select></label>)}
        </div>
        <label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort books</span><select value={sort} onChange={(event) => updateFilter('sort', event.target.value)}>{Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {facetError && <p className="filter-feedback" role="alert">Filters could not load. <button type="button" onClick={() => { setFacetError(''); setFacetRetry((count) => count + 1) }}>Try again</button></p>}
      <section className="library-results" aria-live="polite">
        <div className="results-heading"><h2>{isFiltered ? 'Matching books' : 'All books'} <span>{results.total}</span></h2><p>Your next chapter is here.</p></div>
        {results.loading ? <div className="empty-state">Loading books…</div> : results.error && !results.items.length ? <div className="empty-state"><BookOpen size={35} /><h3>Could not load books</h3><p>{results.error}</p><button type="button" className="secondary-button" onClick={results.retry}>Try again</button></div> : results.items.length ? <><BookGrid books={results.items} /><PagedFooter shown={results.items.length} total={results.total} hasMore={results.hasMore} loadingMore={results.loadingMore} error={results.error} onLoadMore={results.loadMore} /></> : results.loaded && <div className="empty-state"><BookOpen size={35} /><h3>{isFiltered ? 'No books found' : 'No books indexed yet'}</h3><p>{isFiltered ? 'Try another search or change your filters.' : 'Books will appear here after they are added to your archive and indexed.'}</p>{isFiltered && <button type="button" className="secondary-button" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}</div>}
      </section>
    </div>
  )
}
