import { ArrowUpRight, Database, Download, Gamepad2, HardDrive, Music2, Settings2, Sparkles } from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import SectionHeader from '../components/common/SectionHeader.jsx'
import { albums } from '../data/mockMusic.js'
import { games } from '../data/mockGames.js'

const quickActions = [
  { label: 'Explore music', detail: 'Albums & artists', icon: Music2, to: '/music' },
  { label: 'Browse games', detail: 'Your game shelf', icon: Gamepad2, to: '/games' },
  { label: 'Downloads', detail: 'Available soon', icon: Download },
  { label: 'Settings', detail: 'Available soon', icon: Settings2 },
]

export default function Home() {
  const { notify } = useOutletContext()

  return (
    <div className="home-page page-stack">
      <section className="welcome-panel">
        <div className="welcome-content">
          <span className="eyebrow"><Sparkles size={14} /> THE COLLECTION IS YOURS</span>
          <h1>Welcome home<span>.</span></h1>
          <p>Your music, games, and memories — beautifully kept in one place.</p>
          <div className="welcome-actions"><Link to="/music" className="primary-button">Explore your music <ArrowUpRight size={17} /></Link><span className="welcome-caption">A personal archive, always close.</span></div>
        </div>
        <div className="hero-art" aria-hidden="true"><img src="/art/midnight-bloom.webp" alt="" /><img src="/art/elden-ring.webp" alt="" /><img src="/art/northern-skies.webp" alt="" /></div>
      </section>

      <div className="overview-label"><span>AT A GLANCE</span><span className="preview-badge"><i className="status-dot" /> Preview library · Mock data</span></div>
      <section className="overview-grid" aria-label="Archive overview">
        <article className="overview-card storage-card">
          <div className="overview-icon"><HardDrive size={21} /></div>
          <div className="overview-card-body"><span>STORAGE OVERVIEW</span><div className="storage-value"><strong>3.6 TB</strong><small>/ 8 TB</small></div><div className="progress-track"><span style={{ width: '45%' }} /></div><p>45% used <span>4.4 TB available</span></p></div>
        </article>
        <article className="overview-card">
          <div className="overview-icon amber"><Music2 size={21} /></div>
          <div className="overview-card-body"><span>MUSIC COLLECTION</span><div className="metric-value">1,248 <small>files</small></div><p>FLAC & lossless audio <span>1.1 TB</span></p></div>
        </article>
        <article className="overview-card">
          <div className="overview-icon plum"><Gamepad2 size={22} /></div>
          <div className="overview-card-body"><span>GAME LIBRARY</span><div className="metric-value">86 <small>titles</small></div><p>Across 4 platforms <span>2.0 TB</span></p></div>
        </article>
      </section>

      <section className="home-section"><SectionHeader title="Recently added music" subtitle="A few new sounds for your shelf" to="/music" /><AlbumGrid albums={albums.slice(0, 4)} compact /></section>
      <section className="home-section"><SectionHeader title="Recently added games" subtitle="Ready when you are" to="/games" /><GameGrid games={games.slice(0, 4)} notify={notify} compact /></section>
      <section className="home-section quick-section"><SectionHeader title="Jump back in" subtitle="Everything in its place" /><div className="quick-grid">{quickActions.map(({ label, detail, icon: Icon, to }) => to ? <Link to={to} className="quick-card" key={label}><span className="quick-icon"><Icon size={22} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={17} className="quick-arrow" /></Link> : <button type="button" className="quick-card" key={label} onClick={() => notify(`${label} is coming soon`)}><span className="quick-icon"><Icon size={22} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={17} className="quick-arrow" /></button>)}</div></section>
      <div className="home-footer"><Database size={15} /> Built for your local collection. Yours to keep.</div>
    </div>
  )
}
