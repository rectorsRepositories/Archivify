import { ArrowDownUp, Disc3, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import { albums } from '../data/mockMusic.js'

export default function Music() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const [genre, setGenre] = useState('All albums')
  const [year, setYear] = useState('All years')
  const [sort, setSort] = useState('Recently added')

  function setSearch(value) {
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    setParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return albums.filter((album) => {
      const matchesSearch = !query || `${album.title} ${album.artist} ${album.genre} ${album.mood}`.toLowerCase().includes(query)
      return matchesSearch && (genre === 'All albums' || album.genre === genre) && (year === 'All years' || String(album.year) === year)
    }).sort((a, b) => sort === 'Title A–Z' ? a.title.localeCompare(b.title) : sort === 'Oldest first' ? a.year - b.year : b.year - a.year)
  }, [search, genre, year, sort])

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">THE SOUNDTRACK TO EVERYTHING</span><h1>Music library<span className="heading-dot">.</span></h1><p>Rediscover the albums that make this collection yours.</p></div><div className="heading-stat"><Disc3 size={24} /><span><strong>{albums.length} albums</strong><small>Lossless collection</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search albums, artists, genres..." label="Search music library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {filtered.length} shown</div></div>
      <div className="filter-row"><FilterBar options={['All albums', 'Electronic', 'Ambient', 'Indie']} value={genre} onChange={setGenre} label="Filter albums by genre" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option>All years</option><option>2024</option><option>2023</option><option>2022</option><option>2021</option></select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort albums</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Recently added</option><option>Title A–Z</option><option>Oldest first</option></select></label></div></div>
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>Albums <span>{filtered.length}</span></h2><p>Artwork worth getting lost in.</p></div>{filtered.length ? <AlbumGrid albums={filtered} /> : <div className="empty-state"><Disc3 size={35} /><h3>No albums found</h3><p>Try another search or change your filters.</p><button type="button" className="secondary-button" onClick={() => { setSearch(''); setGenre('All albums'); setYear('All years') }}>Clear filters</button></div>}</section>
    </div>
  )
}
