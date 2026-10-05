import { ArrowDownUp, Disc3, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import PagedFooter from '../components/common/PagedFooter.jsx'
import { getAlbumFacets, listAlbums } from '../api/music.js'
import useDebouncedValue from '../hooks/useDebouncedValue.js'
import usePagedResults from '../hooks/usePagedResults.js'

const sortValues = {
  'Newest year': 'newest',
  'Oldest year': 'oldest',
  'Title A–Z': 'title',
  'Artist A–Z': 'artist',
}

export default function Music() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const [genre, setGenre] = useState('All albums')
  const [year, setYear] = useState('All years')
  const [sort, setSort] = useState('Newest year')
  const [facets, setFacets] = useState({ genres: [], years: [] })
  const [facetError, setFacetError] = useState('')
  const [facetRetry, setFacetRetry] = useState(0)
  const debouncedSearch = useDebouncedValue(search)
  const filters = {
    q: debouncedSearch.trim(),
    genre: genre === 'All albums' ? '' : genre,
    year: year === 'All years' ? '' : year,
    sort: sortValues[sort],
  }
  const { items: albums, total, loaded, loading, loadingMore, error, hasMore, loadMore, retry } =
    usePagedResults(listAlbums, filters)

  useEffect(() => {
    const controller = new AbortController()
    getAlbumFacets({ signal: controller.signal })
      .then(setFacets)
      .catch((cause) => { if (!controller.signal.aborted) setFacetError(cause.message) })
    return () => controller.abort()
  }, [facetRetry])

  function setSearch(value) {
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setSearch('')
    setGenre('All albums')
    setYear('All years')
  }

  const isFiltered = Boolean(filters.q || filters.genre || filters.year)

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">THE SOUNDTRACK TO EVERYTHING</span><h1>Music library<span className="heading-dot">.</span></h1><p>Rediscover the albums that make this collection yours.</p></div><div className="heading-stat"><Disc3 size={24} /><span><strong>{total} albums</strong><small>{isFiltered ? 'Matching your filters' : 'Your indexed collection'}</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search albums and artists..." label="Search music library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {albums.length} of {total} shown</div></div>
      <div className="filter-row"><FilterBar options={['All albums', ...facets.genres]} value={genre} onChange={setGenre} label="Filter albums by genre" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option>All years</option>{facets.years.map((item) => <option key={item}>{item}</option>)}</select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort albums</span><select value={sort} onChange={(event) => setSort(event.target.value)}>{Object.keys(sortValues).map((option) => <option key={option}>{option}</option>)}</select></label></div></div>
      {facetError && <p className="filter-feedback" role="alert">Filters could not load. <button type="button" onClick={() => { setFacetError(''); setFacetRetry((count) => count + 1) }}>Try again</button></p>}
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>Albums <span>{total}</span></h2><p>Music from your archive.</p></div>{loading ? <div className="empty-state">Loading albums…</div> : error && !albums.length ? <div className="empty-state"><Disc3 size={35} /><h3>Could not load albums</h3><p>{error}</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></div> : albums.length ? <><AlbumGrid albums={albums} /><PagedFooter shown={albums.length} total={total} hasMore={hasMore} loadingMore={loadingMore} error={error} onLoadMore={loadMore} /></> : loaded && <div className="empty-state"><Disc3 size={35} /><h3>{isFiltered ? 'No albums found' : 'No albums indexed yet'}</h3><p>{isFiltered ? 'Try another search or change your filters.' : 'Run the indexers to add music to your library.'}</p>{isFiltered && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>}</section>
    </div>
  )
}
