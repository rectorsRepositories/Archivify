import { ArrowLeft, Disc3, Download, Headphones, ListPlus, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import TrackList from '../components/music/TrackList.jsx'
import { getAlbum, getAlbumTracks } from '../api/music.js'
import { artistNames, formatBytes } from '../api/format.js'

export default function Album() {
  const { id } = useParams()
  const { notify, playQueue, addToQueue, playback } = useOutletContext()
  const [album, setAlbum] = useState(null)
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([getAlbum(id, { signal: controller.signal }), getAlbumTracks(id, { signal: controller.signal })])
      .then(([details, albumTracks]) => { setAlbum(details); setTracks(albumTracks) })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.status === 404 ? 'Album not found.' : cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry])

  if (loading) return <div className="empty-state">Loading album…</div>
  if (error) return <div className="empty-state not-found"><Disc3 size={38} /><h1>{error === 'Album not found.' ? error : 'Could not load album'}</h1><p>{error === 'Album not found.' ? 'This album is not in the indexed collection.' : error}</p>{error !== 'Album not found.' && <button type="button" className="secondary-button" onClick={() => setRetry((count) => count + 1)}>Try again</button>}<Link to="/music" className="primary-button">Back to music</Link></div>
  if (!album) return null

  const formats = [...new Set(tracks.map((track) => track.extension?.replace(/^\./, '').toUpperCase()).filter(Boolean))]
  const formatLabel = formats.length === 1 ? formats[0] : formats.length ? 'Mixed formats' : 'Audio'
  const activeItem = playback?.items[playback.index]
  const activeTrackId = activeItem?.album.id === album.id ? activeItem.track.id : null

  function playTrack(index) {
    playQueue(tracks, index, album)
  }

  function queueTracks(selectedTracks) {
    addToQueue(selectedTracks, album)
    notify(selectedTracks.length === 1 ? `Added ${selectedTracks[0].title} to the queue` : `Added ${selectedTracks.length} tracks to the queue`)
  }

  return (
    <div className="album-page page-stack">
      <div className="breadcrumbs"><Link to="/music"><ArrowLeft size={15} /> Music library</Link><span>/</span><span>{album.title}</span></div>
      <section className="album-hero"><div className="album-hero-backdrop" style={album.artwork_url ? { backgroundImage: `url(${album.artwork_url})` } : undefined} />{album.artwork_url ? <img className="album-hero-art" src={album.artwork_url} alt={`${album.title} album artwork`} /> : <div className="album-hero-art art-placeholder"><Disc3 size={70} aria-hidden="true" /></div>}<div className="album-hero-info"><div className="eyebrow"><Disc3 size={14} /> ALBUM</div><h1>{album.title}</h1><p className="album-artist">{artistNames(album.artists)}</p><div className="album-tags">{album.release_year && <span>{album.release_year}</span>}<span>{album.track_count} tracks</span><span>{formatLabel}</span><span>{formatBytes(album.size_bytes)}</span></div>{album.genre && <div className="genre-tags"><span>{album.genre}</span></div>}<div className="album-actions"><button type="button" className="primary-button" onClick={() => playTrack(0)} disabled={!tracks.length}><Play size={16} fill="currentColor" /> Play album</button><button type="button" className="secondary-button" onClick={() => queueTracks(tracks)} disabled={!tracks.length}><ListPlus size={17} /> Add album to queue</button><a className="secondary-button" href={album.download_url}><Download size={17} /> Download album</a></div></div></section>
      <section id="album-tracks" className="track-section"><div className="section-header"><div><h2>Tracks <span className="section-count">{tracks.length}</span></h2><p>Indexed audio files</p></div><span className="track-format"><Headphones size={16} /> {formatLabel} audio</span></div><TrackList tracks={tracks} albumArtist={artistNames(album.artists)} onPlay={playTrack} onQueue={(index) => queueTracks([tracks[index]])} activeTrackId={activeTrackId} /></section>
    </div>
  )
}
