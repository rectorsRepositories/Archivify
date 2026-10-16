import AlbumCard from './AlbumCard.jsx'

export default function AlbumGrid({ albums, compact = false }) {
  return (
    <div className={`album-grid${compact ? ' compact-grid' : ''}`}>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} compact={compact} />
      ))}
    </div>
  )
}
