import { ArrowDownUp, Gamepad2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import { getGames } from '../api/games.js'

export default function Games() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('All platforms')
  const [genre, setGenre] = useState('All genres')
  const [sort, setSort] = useState('Title A–Z')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    getGames({ signal: controller.signal })
      .then(setGames)
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])

  const platforms = useMemo(() => [...new Set(games.map((game) => game.platform))].sort(), [games])
  const genres = useMemo(() => [...new Set(games.map((game) => game.genre).filter(Boolean))].sort(), [games])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return games.filter((game) => {
      const matchesSearch = !query || `${game.title} ${game.platform} ${game.genre || ''}`.toLowerCase().includes(query)
      return matchesSearch && (platform === 'All platforms' || game.platform === platform) && (genre === 'All genres' || game.genre === genre)
    }).sort((a, b) => {
      if (sort === 'Newest year') return (b.release_year ?? -Infinity) - (a.release_year ?? -Infinity) || a.title.localeCompare(b.title)
      if (sort === 'Oldest year') return (a.release_year ?? Infinity) - (b.release_year ?? Infinity) || a.title.localeCompare(b.title)
      return a.title.localeCompare(b.title)
    })
  }, [games, search, platform, genre, sort])

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h1>Games library<span className="heading-dot">.</span></h1><p>Browse and download games from your archive.</p></div><div className="heading-stat"><Gamepad2 size={25} /><span><strong>{games.length} games</strong><small>Your indexed collection</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search games, platforms, genres..." label="Search games library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {filtered.length} shown</div></div>
      <div className="filter-row"><FilterBar options={['All platforms', ...platforms]} value={platform} onChange={setPlatform} label="Filter games by platform" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option>All genres</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort games</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Title A–Z</option><option>Newest year</option><option>Oldest year</option></select></label></div></div>
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>All games <span>{filtered.length}</span></h2><p>Games from your archive.</p></div>{loading ? <div className="empty-state">Loading games…</div> : error ? <div className="empty-state"><Gamepad2 size={35} /><h3>Could not load games</h3><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry((count) => count + 1)}>Try again</button></div> : filtered.length ? <GameGrid games={filtered} /> : <div className="empty-state"><Gamepad2 size={35} /><h3>{games.length ? 'No games found' : 'No games indexed yet'}</h3><p>{games.length ? 'Try another search or change your filters.' : 'Run the game indexer to add playable disc images.'}</p>{games.length > 0 && <button type="button" className="secondary-button" onClick={() => { setSearch(''); setPlatform('All platforms'); setGenre('All genres') }}>Clear filters</button>}</div>}</section>
    </div>
  )
}
