import { ArrowDownUp, Gamepad2, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import SearchBar from '../components/common/SearchBar.jsx'
import FilterBar from '../components/common/FilterBar.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import { games } from '../data/mockGames.js'

export default function Games() {
  const { notify } = useOutletContext()
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('All platforms')
  const [genre, setGenre] = useState('All genres')
  const [sort, setSort] = useState('Recently added')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return games.filter((game) => (!query || `${game.title} ${game.platform} ${game.genre}`.toLowerCase().includes(query)) && (platform === 'All platforms' || game.platform === platform) && (genre === 'All genres' || game.genre === genre)).sort((a, b) => sort === 'Title A–Z' ? a.title.localeCompare(b.title) : sort === 'Oldest first' ? a.year - b.year : b.year - a.year)
  }, [search, platform, genre, sort])

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">WORLDS WORTH RETURNING TO</span><h1>Games library<span className="heading-dot">.</span></h1><p>Every adventure, right where you left it.</p></div><div className="heading-stat"><Gamepad2 size={25} /><span><strong>{games.length} games</strong><small>4 platforms</small></span></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search games, platforms, genres..." label="Search games library" /><div className="toolbar-count"><SlidersHorizontal size={16} /> {filtered.length} shown</div></div>
      <div className="filter-row"><FilterBar options={['All platforms', 'PC', 'PlayStation', 'Xbox', 'Nintendo']} value={platform} onChange={setPlatform} label="Filter games by platform" /><div className="filter-selects"><label className="select-wrap"><span className="sr-only">Filter by genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option>All genres</option><option>RPG</option><option>Adventure</option><option>Racing</option></select></label><label className="select-wrap sort-select"><ArrowDownUp size={15} /><span className="sr-only">Sort games</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Recently added</option><option>Title A–Z</option><option>Oldest first</option></select></label></div></div>
      <section className="library-results" aria-live="polite"><div className="results-heading"><h2>All games <span>{filtered.length}</span></h2><p>Your entire collection, one shelf.</p></div>{filtered.length ? <GameGrid games={filtered} notify={notify} /> : <div className="empty-state"><Gamepad2 size={35} /><h3>No games found</h3><p>Try another search or change your filters.</p><button type="button" className="secondary-button" onClick={() => { setSearch(''); setPlatform('All platforms'); setGenre('All genres') }}>Clear filters</button></div>}</section>
    </div>
  )
}
