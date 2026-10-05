import { Disc3, Download, Gamepad2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import PagedFooter from '../components/common/PagedFooter.jsx'
import { listAlbums } from '../api/music.js'
import { listGames } from '../api/games.js'
import { artistNames, formatBytes } from '../api/format.js'
import usePagedResults from '../hooks/usePagedResults.js'

function DownloadSection({ title, icon: Icon, results, describe, itemDetail }) {
  return (
    <section className="download-section">
      <div className="results-heading"><h2><Icon size={19} /> {title} <span>{results.total}</span></h2><p>{describe}</p></div>
      {results.loading ? <div className="search-loading">Loading {title.toLowerCase()}…</div> : results.error && !results.items.length ? <div className="empty-state"><h3>Could not load {title.toLowerCase()}</h3><p>{results.error}</p><button type="button" className="secondary-button" onClick={results.retry}>Try again</button></div> : results.items.length ? <>
        <div className="download-list">{results.items.map((item) => <div className="download-row" key={item.id}><div className="download-row-art">{item.artwork_url ? <img src={item.artwork_url} alt="" loading="lazy" /> : <Icon size={24} aria-hidden="true" />}</div><div className="download-row-info"><strong>{item.title}</strong><small>{itemDetail(item)} · {formatBytes(item.size_bytes)}</small></div><a href={item.download_url} className="secondary-button" aria-label={'Download ' + item.title}><Download size={16} /> Download</a></div>)}</div>
        <PagedFooter shown={results.items.length} total={results.total} hasMore={results.hasMore} loadingMore={results.loadingMore} error={results.error} onLoadMore={results.loadMore} />
      </> : <div className="search-no-results">No {title.toLowerCase()} are indexed yet.</div>}
    </section>
  )
}

export default function Downloads() {
  const albums = usePagedResults(listAlbums, { sort: 'title' }, 12)
  const games = usePagedResults(listGames, { sort: 'title' }, 12)

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">TAKE YOUR COLLECTION WITH YOU</span><h1>Downloads<span className="heading-dot">.</span></h1><p>Save complete albums or game files from your archive.</p></div></div>
      <div className="download-intro">Need one song? Open an <Link to="/music">album</Link> to download individual tracks.</div>
      <DownloadSection title="Music" icon={Disc3} results={albums} describe="Albums as ZIP files" itemDetail={(album) => artistNames(album.artists)} />
      <DownloadSection title="Games" icon={Gamepad2} results={games} describe="Original game files" itemDetail={(game) => game.platform} />
    </div>
  )
}
