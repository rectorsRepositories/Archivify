import { Link } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { artistNames } from '../../api/format.js'

export default function AlbumCard({ album, compact = false }) {
  return (
    <Link to={`/music/albums/${album.id}`} className={`album-card${compact ? ' compact' : ''}`}>
      <span className="album-art-frame">{album.artwork_url ? <img src={album.artwork_url} alt={`${album.title} album artwork`} loading="lazy" /> : <span className="art-placeholder"><Disc3 size={45} aria-hidden="true" /></span>}<span className="art-overlay">View album</span></span>
      <span className="album-meta"><strong>{album.title}</strong><span>{artistNames(album.artists)}</span><small>{album.release_year || 'Year unknown'} <i /> {album.track_count} tracks</small></span>
    </Link>
  )
}
