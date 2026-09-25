import { Link } from 'react-router-dom'

export default function AlbumCard({ album, compact = false }) {
  return (
    <Link to={`/music/albums/${album.id}`} className={`album-card${compact ? ' compact' : ''}`}>
      <span className="album-art-frame"><img src={album.art} alt={`${album.title} album artwork`} loading="lazy" /><span className="art-overlay">View album</span></span>
      <span className="album-meta"><strong>{album.title}</strong><span>{album.artist}</span><small>{album.year} <i /> {album.format}</small></span>
    </Link>
  )
}
