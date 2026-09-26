import { Download, ListPlus, Play } from 'lucide-react'
import { artistNames, formatBytes, formatDuration } from '../../api/format.js'

export default function TrackList({ tracks, albumArtist, onPlay, onQueue, activeTrackId }) {
  return (
    <div className="track-list-wrap">
      <div className="track-list-head"><span>#</span><span>TITLE</span><span>DURATION</span><span>SIZE</span><span className="align-right">ACTIONS</span></div>
      <ol className="track-list">
        {tracks.map((track, index) => (
          <li key={track.id} className="track-row">
            <span className="track-number">{track.track_number ?? String(index + 1).padStart(2, '0')}</span>
            <span className="track-title"><strong>{track.title}</strong><small>{track.artists?.length ? artistNames(track.artists) : albumArtist}</small></span>
            <span className="track-data">{formatDuration(track.duration_ms)}</span><span className="track-data">{formatBytes(track.size_bytes)}</span>
            <span className="track-actions">
              <button type="button" className="row-icon" aria-label={`Play ${track.title}`} aria-pressed={activeTrackId === track.id} onClick={() => onPlay(index)}><Play size={15} fill="currentColor" /></button>
              <button type="button" className="row-icon" aria-label={`Add ${track.title} to queue`} onClick={() => onQueue(index)}><ListPlus size={17} /></button>
              <a className="row-icon" aria-label={`Download ${track.title}`} href={track.download_url}><Download size={16} /></a>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
