import AlbumCard from './AlbumCard.jsx'

export default function AlbumGrid({ albums: items, compact = false }) {
  return <div className={`album-grid${compact ? ' compact-grid' : ''}`}>{items.map((album) => <AlbumCard key={album.id} album={album} compact={compact} />)}</div>
}
