import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Gamepad2, House, Menu, Music2, X } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import MusicPlayer from '../music/MusicPlayer.jsx'

export default function PageLayout() {
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [playback, setPlayback] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(80)
  const [playerError, setPlayerError] = useState('')
  const audioRef = useRef(null)
  const requestId = useRef(0)
  const location = useLocation()
  const currentTrack = playback?.items[playback.index]?.track

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!currentTrack || !audioRef.current) return
    const audio = audioRef.current
    audio.volume = volume / 100
    audio.load()
    setPlayerError('')
    audio.play().catch((error) => {
      if (error.name !== 'AbortError') {
        setIsPlaying(false)
        setPlayerError('Playback could not start. Try Play or download the track.')
      }
    })
  }, [playback?.index, playback?.requestId])
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100
  }, [volume])

  const notify = (message) => setToast(message)

  function playQueue(tracks, index, album) {
    if (!tracks.length || index < 0 || index >= tracks.length) return
    requestId.current += 1
    setPlayback({ items: tracks.map((track) => ({ track, album })), index, requestId: requestId.current })
  }

  function addToQueue(tracks, album) {
    if (!tracks.length) return
    const items = tracks.map((track) => ({ track, album }))
    const resumeFinishedQueue = audioRef.current?.ended
    requestId.current += 1
    const newRequestId = requestId.current
    setPlayback((current) => {
      if (current) return {
        ...current,
        items: [...current.items, ...items],
        index: resumeFinishedQueue && current.index === current.items.length - 1
          ? current.items.length : current.index,
      }
      return { items, index: 0, requestId: newRequestId }
    })
  }

  function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => setPlayerError('Playback could not start. Try downloading the track.'))
    } else {
      audio.pause()
    }
  }

  function nextTrack() {
    setPlayback((current) => current && current.index < current.items.length - 1
      ? { ...current, index: current.index + 1 } : current)
  }

  function previousTrack() {
    setPlayback((current) => current && current.index > 0
      ? { ...current, index: current.index - 1 } : current)
  }

  function stopPlayback() {
    audioRef.current?.pause()
    setPlayback(null)
    setIsPlaying(false)
    setPlayerError('')
  }

  function handleEnded() {
    if (playback && playback.index < playback.items.length - 1) nextTrack()
    else setIsPlaying(false)
  }

  return (
    <div className="app-shell">
      <div className={menuOpen ? 'sidebar-shell open' : 'sidebar-shell'}>
        <Sidebar notify={notify} />
      </div>
      {menuOpen && <button type="button" className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <div className="app-main">
        <Header notify={notify} onMenu={() => setMenuOpen(true)} />
        <main className={playback ? 'page-content has-player' : 'page-content'}><Outlet context={{ notify, playQueue, addToQueue, playback }} /></main>
      </div>
      {playback && <audio ref={audioRef} src={currentTrack.content_url} onPlay={() => { setIsPlaying(true); setPlayerError('') }} onPause={() => setIsPlaying(false)} onEnded={handleEnded} onError={() => { setIsPlaying(false); setPlayerError('This browser cannot play this audio format. Download the track instead.') }} />}
      <MusicPlayer playback={playback} isPlaying={isPlaying} volume={volume} error={playerError} onToggle={togglePlayback} onPrevious={previousTrack} onNext={nextTrack} onVolumeChange={setVolume} onClose={stopPlayback} />
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end><House size={20} /><span>Home</span></NavLink>
        <NavLink to="/music"><Music2 size={20} /><span>Music</span></NavLink>
        <NavLink to="/games"><Gamepad2 size={20} /><span>Games</span></NavLink>
        <button type="button" onClick={() => setMenuOpen(true)}><Menu size={20} /><span>More</span></button>
      </nav>
      {toast && <div className={playback ? 'toast toast-with-player' : 'toast'} role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
    </div>
  )
}
