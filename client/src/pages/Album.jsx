import { ArrowLeft, Download, Disc3, Headphones, Play } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import TrackList from '../components/music/TrackList.jsx'
import { getMockAlbum } from '../data/mockMusic.js'

export default function Album() {
  const { id } = useParams()
  const { notify } = useOutletContext()
  const album = getMockAlbum(id)

  if (!album) return <div className="empty-state not-found"><Disc3 size={38} /><h1>Album not found</h1><p>This album is not in the preview collection.</p><Link to="/music" className="primary-button">Back to music</Link></div>

  return (
    <div className="album-page page-stack">
      <div className="breadcrumbs"><Link to="/music"><ArrowLeft size={15} /> Music library</Link><span>/</span><span>{album.title}</span></div>
      <section className="album-hero"><div className="album-hero-backdrop" style={{ backgroundImage: `url(${album.art})` }} /><img className="album-hero-art" src={album.art} alt={`${album.title} album artwork`} /><div className="album-hero-info"><div className="eyebrow"><Disc3 size={14} /> ALBUM</div><h1>{album.title}</h1><p className="album-artist">{album.artist}</p><p className="album-description">{album.description}</p><div className="album-tags"><span>{album.year}</span><span>{album.tracks.length} tracks</span><span>{album.format}</span><span>{album.size}</span></div><div className="genre-tags"><span>{album.genre}</span><span>{album.mood}</span></div><div className="album-actions"><button type="button" className="primary-button" onClick={() => notify('Audio streaming is coming soon')}><Play size={16} fill="currentColor" /> Play album</button><button type="button" className="secondary-button" onClick={() => notify('Album downloads will be available when the library is connected')}><Download size={17} /> Download album</button></div></div></section>
      <section className="track-section"><div className="section-header"><div><h2>Tracks <span className="section-count">{album.tracks.length}</span></h2><p>All tracks in lossless quality</p></div><span className="track-format"><Headphones size={16} /> {album.format} audio</span></div><TrackList album={album} notify={notify} /></section>
    </div>
  )
}
