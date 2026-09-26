import { Disc3, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { artistNames } from '../../api/format.js'

export default function MusicPlayer({ playback, isPlaying, volume, error, onToggle, onPrevious, onNext, onVolumeChange, onClose }) {
  if (!playback) return null

  const { track, album } = playback.items[playback.index]
  const artist = track.artists?.length ? artistNames(track.artists) : artistNames(album.artists)

  return (
    <section className="music-player" aria-label="Music player">
      <div className="music-player-main">
        <div className="music-player-art">{album.artwork_url ? <img src={album.artwork_url} alt="" /> : <Disc3 size={24} aria-hidden="true" />}</div>
        <div className="music-player-info" aria-live="polite">
          <Link to={`/music/albums/${album.id}`} title={track.title}>{track.title}</Link>
          <span title={artist}>{artist}</span>
          <small>{playback.index + 1} of {playback.items.length} in queue</small>
          {error && <small role="alert">{error}</small>}
        </div>
        <div className="music-player-controls">
          <button type="button" onClick={onPrevious} disabled={playback.index === 0} aria-label="Previous song"><SkipBack size={17} fill="currentColor" /></button>
          <button type="button" className="music-player-toggle" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
          <button type="button" onClick={onNext} disabled={playback.index === playback.items.length - 1} aria-label="Next song"><SkipForward size={17} fill="currentColor" /></button>
        </div>
        <button type="button" className="music-player-close" onClick={onClose} aria-label="Stop and close player"><X size={16} /></button>
      </div>
      <div className="music-player-volume">
        {volume === 0 ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
        <input type="range" min="0" max="100" value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="Volume" />
        <output>{volume}%</output>
      </div>
    </section>
  )
}
