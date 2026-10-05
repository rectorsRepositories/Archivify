import { ArrowDownUp, Gamepad2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import PagedFooter from '../components/common/PagedFooter.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import { getGameFacets, listGames } from '../api/games.js'
import useDebouncedValue from '../hooks/useDebouncedValue.js'
import usePagedResults from '../hooks/usePagedResults.js'

const sortValues = {
  'Title A–Z': 'title',
  'Newest year': 'newest',
  'Oldest year': 'oldest',
}

export default function Games() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const [platform, setPlatform] = useState('All platforms')
  const [genre, setGenre] = useState('All genres')
  const [sort, setSort] = useState('Title A–Z')
  const [facets, setFacets] = useState({ platforms: [], genres: [] })
  const [facetError, setFacetError] = useState('')
  const [facetRetry, setFacetRetry] = useState(0)
  const debouncedSearch = useDebouncedValue(search)
  const filters = {
    q: debouncedSearch.trim(),
    platform: platform === 'All platforms' ? '' : platform,
    genre: genre === 'All genres' ? '' : genre,
    sort: sortValues[sort],
  }
  const { items: games, total, loaded, loading, loadingMore, error, hasMore, loadMore, retry } =
    usePagedResults(listGames, filters)

  useEffect(() => {
    const controller = new AbortController()
    getGameFacets({ signal: controller.signal })
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
    setPlatform('All platforms')
    setGenre('All genres')
  }

  const isFiltered = Boolean(filters.q || filters.platform || filters.genre)

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h1>Games library<span className="heading-dot">.</span></h1><p>Browse and download games from your archive.</p></div><div className="heading-stat"><Gamepad2 size={25} /><span><strong>{total} games</strong><small>{isFiltered ? 'Matching your filters' : 'Your indexed collection'}</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search games and platforms..." label="Search games library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {games.length} of {total} shown</div></div>
      <div className="filter-row"><FilterBar options={['All platforms', ...facets.platforms]} value={platform} onChange={setPlatform} label="Filter games by platform" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option>All genres</option>{facets.genres.map((item) => <option key={item}>{item}</option>)}</select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort games</span><select value={sort} onChange={(event) => setSort(event.target.value)}>{Object.keys(sortValues).map((option) => <option key={option}>{option}</option>)}</select></label></div></div>
      {facetError && <p className="filter-feedback" role="alert">Filters could not load. <button type="button" onClick={() => { setFacetError(''); setFacetRetry((count) => count + 1) }}>Try again</button></p>}
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>All games <span>{total}</span></h2><p>Games from your archive.</p></div>{loading ? <div className="empty-state">Loading games…</div> : error && !games.length ? <div className="empty-state"><Gamepad2 size={35} /><h3>Could not load games</h3><p>{error}</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></div> : games.length ? <><GameGrid games={games} /><PagedFooter shown={games.length} total={total} hasMore={hasMore} loadingMore={loadingMore} error={error} onLoadMore={loadMore} /></> : loaded && <div className="empty-state"><Gamepad2 size={35} /><h3>{isFiltered ? 'No games found' : 'No games indexed yet'}</h3><p>{isFiltered ? 'Try another search or change your filters.' : 'Run the game indexer to add playable disc images.'}</p>{isFiltered && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>}</section>
    </div>
  )
}
