import { ArrowDownUp, Disc3, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import { getAlbums } from '../api/music.js'
import { artistNames } from '../api/format.js'

export default function Music() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const [albums, setAlbums] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [genre, setGenre] = useState('All albums')
  const [year, setYear] = useState('All years')
  const [sort, setSort] = useState('Newest year')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    getAlbums({ signal: controller.signal })
      .then(setAlbums)
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])

  function setSearch(value) {
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    setParams(next, { replace: true })
  }

  const genres = useMemo(() => [...new Set(albums.map((album) => album.genre).filter(Boolean))].sort(), [albums])
  const years = useMemo(() => [...new Set(albums.map((album) => album.release_year).filter(Boolean))].sort((a, b) => b - a), [albums])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return albums.filter((album) => {
      const matchesSearch = !query || `${album.title} ${artistNames(album.artists)} ${album.genre || ''}`.toLowerCase().includes(query)
      return matchesSearch && (genre === 'All albums' || album.genre === genre) && (year === 'All years' || String(album.release_year) === year)
    }).sort((a, b) => {
      if (sort === 'Artist A–Z') return artistNames(a.artists).localeCompare(artistNames(b.artists)) || a.title.localeCompare(b.title)
      if (sort === 'Title A–Z') return a.title.localeCompare(b.title)
      const yearDifference = sort === 'Oldest year'
        ? (a.release_year ?? Infinity) - (b.release_year ?? Infinity)
        : (b.release_year ?? -Infinity) - (a.release_year ?? -Infinity)
      return yearDifference || a.title.localeCompare(b.title)
    })
  }, [albums, search, genre, year, sort])

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">THE SOUNDTRACK TO EVERYTHING</span><h1>Music library<span className="heading-dot">.</span></h1><p>Rediscover the albums that make this collection yours.</p></div><div className="heading-stat"><Disc3 size={24} /><span><strong>{albums.length} albums</strong><small>Your indexed collection</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search albums, artists, genres..." label="Search music library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {filtered.length} shown</div></div>
      <div className="filter-row"><FilterBar options={['All albums', ...genres]} value={genre} onChange={setGenre} label="Filter albums by genre" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option>All years</option>{years.map((item) => <option key={item}>{item}</option>)}</select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort albums</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest year</option><option>Title A–Z</option><option>Artist A–Z</option><option>Oldest year</option></select></label></div></div>
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>Albums <span>{filtered.length}</span></h2><p>Music from your archive.</p></div>{loading ? <div className="empty-state">Loading albums…</div> : error ? <div className="empty-state"><Disc3 size={35} /><h3>Could not load albums</h3><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry((count) => count + 1)}>Try again</button></div> : filtered.length ? <AlbumGrid albums={filtered} /> : <div className="empty-state"><Disc3 size={35} /><h3>{albums.length ? 'No albums found' : 'No albums indexed yet'}</h3><p>{albums.length ? 'Try another search or change your filters.' : 'Run the indexers to add music to your library.'}</p>{albums.length > 0 && <button type="button" className="secondary-button" onClick={() => { setSearch(''); setGenre('All albums'); setYear('All years') }}>Clear filters</button>}</div>}</section>
    </div>
  )
}
