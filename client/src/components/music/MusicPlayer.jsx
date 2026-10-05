import { ArrowDown, ArrowUp, Disc3, ListMusic, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { artistNames, formatDuration } from '../../api/format.js'

export default function MusicPlayer({
  playback, isPlaying, volume, currentTime, duration, error, onToggle, onPrevious,
  onNext, onVolumeChange, onSeek, onSelectQueueItem, onRemoveQueuedItem,
  onMoveQueuedItem, onClose,
}) {
  const [queueOpen, setQueueOpen] = useState(false)
  useEffect(() => { if (!playback) setQueueOpen(false) }, [playback])
  if (!playback) return null

  const { track, album } = playback.items[playback.index]
  const artist = track.artists?.length ? artistNames(track.artists) : artistNames(album.artists)
  const elapsed = formatDuration(currentTime * 1000)
  const total = formatDuration(duration ? duration * 1000 : track.duration_ms)

  return (
    <section className="music-player" aria-label="Music player">
      <div className="music-player-main">
        <div className="music-player-art">{album.artwork_url ? <img src={album.artwork_url} alt="" /> : <Disc3 size={24} aria-hidden="true" />}</div>
        <div className="music-player-info" aria-live="polite">
          <Link to={'/music/albums/' + album.id} title={track.title}>{track.title}</Link>
          <span title={artist}>{artist}</span>
          {error && <small role="alert">{error} <a href={track.download_url}>Download track</a></small>}
        </div>
        <div className="music-player-controls">
          <button type="button" onClick={onPrevious} disabled={playback.index === 0} aria-label="Previous song"><SkipBack size={17} fill="currentColor" /></button>
          <button type="button" className="music-player-toggle" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
          <button type="button" onClick={onNext} disabled={playback.index === playback.items.length - 1} aria-label="Next song"><SkipForward size={17} fill="currentColor" /></button>
        </div>
        <button type="button" className="music-player-close" onClick={onClose} aria-label="Stop and close player"><X size={17} /></button>
      </div>
      <div className="music-player-progress">
        <span>{elapsed}</span>
        <input type="range" min="0" max={Math.max(duration, 1)} step="1" value={Math.min(currentTime, duration || 0)} disabled={!duration} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Seek within track" aria-valuetext={elapsed} />
        <span>{total}</span>
      </div>
      <div className="music-player-bottom">
        <button type="button" className="player-queue-toggle" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="player-queue"><ListMusic size={17} /> Queue <span>{playback.index + 1}/{playback.items.length}</span></button>
        <div className="music-player-volume">
          {volume === 0 ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          <input type="range" min="0" max="100" value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="Volume" />
          <output>{volume}%</output>
        </div>
      </div>
      {queueOpen && <ol id="player-queue" className="player-queue" aria-label="Playback queue">
        {playback.items.map(({ track: queuedTrack, album: queuedAlbum }, index) => <li key={queuedTrack.id + '-' + index} className={index === playback.index ? 'queue-item current' : 'queue-item'}>
          <button type="button" className="queue-select" onClick={() => onSelectQueueItem(index)} disabled={index === playback.index} aria-current={index === playback.index ? 'true' : undefined}><strong>{queuedTrack.title}</strong><small>{artistNames(queuedTrack.artists?.length ? queuedTrack.artists : queuedAlbum.artists)} · {queuedAlbum.title}</small></button>
          {index > playback.index && <div className="queue-actions">
            <button type="button" onClick={() => onMoveQueuedItem(index, -1)} disabled={index === playback.index + 1} aria-label={'Move ' + queuedTrack.title + ' up'}><ArrowUp size={15} /></button>
            <button type="button" onClick={() => onMoveQueuedItem(index, 1)} disabled={index === playback.items.length - 1} aria-label={'Move ' + queuedTrack.title + ' down'}><ArrowDown size={15} /></button>
            <button type="button" onClick={() => onRemoveQueuedItem(index)} aria-label={'Remove ' + queuedTrack.title + ' from queue'}><X size={15} /></button>
          </div>}
        </li>)}
      </ol>}
    </section>
  )
}
