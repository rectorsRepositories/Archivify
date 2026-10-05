import { ArrowUpRight, Database, Download, Gamepad2, HardDrive, Music2, Search, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import SectionHeader from '../components/common/SectionHeader.jsx'
import { listAlbums, getLibrarySummary } from '../api/music.js'
import { listGames } from '../api/games.js'
import { formatBytes } from '../api/format.js'

const quickActions = [
  { label: 'Explore music', detail: 'Albums & artists', icon: Music2, to: '/music' },
  { label: 'Browse games', detail: 'Indexed games', icon: Gamepad2, to: '/games' },
  { label: 'Downloads', detail: 'Albums & games', icon: Download, to: '/downloads' },
  { label: 'Search archive', detail: 'Find anything', icon: Search, to: '/search' },
]

export default function Home() {
  const [summary, setSummary] = useState(null)
  const [albums, setAlbums] = useState([])
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([getLibrarySummary({ signal: controller.signal }), listAlbums({ limit: 4 }, { signal: controller.signal }), listGames({ limit: 4 }, { signal: controller.signal })])
      .then(([librarySummary, musicAlbums, archiveGames]) => { setSummary(librarySummary); setAlbums(musicAlbums.data); setGames(archiveGames.data) })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])

  const totalFiles = summary?.categories.reduce((total, category) => total + category.file_count, 0) ?? 0
  const totalBytes = summary?.categories.reduce((total, category) => total + category.size_bytes, 0) ?? 0
  const musicFiles = summary?.categories.find((category) => category.category === 'music')
  const gameFiles = summary?.categories.find((category) => category.category === 'games')
  const heroArt = albums.filter((album) => album.artwork_url).slice(0, 3)

  return (
    <div className="home-page page-stack">
      <section className="welcome-panel">
        <div className="welcome-content">
          <span className="eyebrow"><Sparkles size={14} /> THE COLLECTION IS YOURS</span>
          <h1>Welcome home<span>.</span></h1>
          <p>Your music, games, and memories — beautifully kept in one place.</p>
          <div className="welcome-actions"><Link to="/music" className="primary-button">Explore your music <ArrowUpRight size={17} /></Link><span className="welcome-caption">A personal archive, always close.</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">{heroArt.map((album) => <img key={album.id} src={album.artwork_url} alt="" />)}</div>
      </section>

      <div className="overview-label"><span>AT A GLANCE</span><span className="preview-badge">Live archive</span></div>
      {loading ? <div className="empty-state">Loading your archive…</div> : error ? <div className="empty-state"><h2>Could not reach the archive API</h2><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry((count) => count + 1)}>Try again</button></div> : <>
        <section className="overview-grid" aria-label="Archive overview">
          <article className="overview-card storage-card"><div className="overview-icon"><HardDrive size={21} /></div><div className="overview-card-body"><span>INDEXED STORAGE</span><div className="storage-value"><strong>{formatBytes(totalBytes)}</strong></div><p>{totalFiles.toLocaleString()} files in your archive</p></div></article>
          <article className="overview-card"><div className="overview-icon amber"><Music2 size={21} /></div><div className="overview-card-body"><span>MUSIC COLLECTION</span><div className="metric-value">{summary.music.albums.toLocaleString()} <small>albums</small></div><p>{summary.music.tracks.toLocaleString()} tracks <span>{formatBytes(musicFiles?.size_bytes ?? 0)}</span></p></div></article>
          <article className="overview-card"><div className="overview-icon plum"><Gamepad2 size={22} /></div><div className="overview-card-body"><span>GAME ARCHIVE</span><div className="metric-value">{summary.games.titles.toLocaleString()} <small>games</small></div><p>{gameFiles?.file_count ?? 0} indexed files <span>{formatBytes(gameFiles?.size_bytes ?? 0)}</span></p></div></article>
        </section>
        <section className="home-section"><SectionHeader title="From your music shelf" subtitle="Albums in your indexed archive" to="/music" />{albums.length ? <AlbumGrid albums={albums.slice(0, 4)} compact /> : <div className="empty-state">No albums indexed yet.</div>}</section>
        <section className="home-section"><SectionHeader title="From your games shelf" subtitle="Games in your indexed archive" to="/games" />{games.length ? <GameGrid games={games.slice(0, 4)} compact /> : <div className="empty-state">No games indexed yet.</div>}</section>
      </>}
      <section className="home-section quick-section"><SectionHeader title="Jump back in" subtitle="Everything in its place" /><div className="quick-grid">{quickActions.map(({ label, detail, icon: Icon, to }) => <Link to={to} className="quick-card" key={label}><span className="quick-icon"><Icon size={22} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={17} className="quick-arrow" /></Link>)}</div></section>
      <div className="home-footer"><Database size={15} /> Built for your local collection. Yours to keep.</div>
    </div>
  )
}
