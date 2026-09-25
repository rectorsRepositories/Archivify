import { Download, Play } from 'lucide-react'

export default function TrackList({ album, notify }) {
  return (
    <div className="track-list-wrap">
      <div className="track-list-head"><span>#</span><span>TITLE</span><span>DURATION</span><span>SIZE</span><span className="align-right">ACTIONS</span></div>
      <ol className="track-list">
        {album.tracks.map(([title, duration, size], index) => (
          <li key={`${album.id}-${title}`} className="track-row">
            <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="track-title"><strong>{title}</strong><small>{album.artist}</small></span>
            <span className="track-data">{duration}</span><span className="track-data">{size}</span>
            <span className="track-actions">
              <button type="button" className="row-icon" aria-label={`Play ${title}`} onClick={() => notify('Audio streaming is coming soon')}><Play size={15} fill="currentColor" /></button>
              <button type="button" className="row-icon" aria-label={`Download ${title}`} onClick={() => notify('Downloads will be available when the library is connected')}><Download size={16} /></button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
