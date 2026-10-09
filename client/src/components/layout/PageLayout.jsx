import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BookOpen, Gamepad2, House, Music2, Search, X } from 'lucide-react'
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
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const audioRef = useRef(null)
  const sidebarRef = useRef(null)
  const menuButtonRef = useRef(null)
  const requestId = useRef(0)
  const location = useLocation()
  const currentTrack = playback?.items[playback.index]?.track

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const update = () => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = isMobile && !menuOpen
    if (!isMobile) setMenuOpen(false)
  }, [isMobile, menuOpen])
  useEffect(() => {
    if (!menuOpen || !isMobile) return undefined
    const sidebar = sidebarRef.current
    const focusable = [...sidebar.querySelectorAll('a[href], button:not([disabled])')]
    focusable[0]?.focus()

    // Keep keyboard focus in the open mobile navigation and restore it on close.
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
      } else if (event.key === 'Tab' && focusable.length) {
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); menuButtonRef.current?.focus() }
  }, [menuOpen, isMobile])
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
    setCurrentTime(0)
    setDuration(0)
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
    // A queue that reached its last track should begin the newly appended tracks.
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
    setCurrentTime(0)
    setDuration(0)
  }

  function seekTo(seconds) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration))
    setCurrentTime(audio.currentTime)
  }

  function selectQueueItem(index) {
    requestId.current += 1
    setPlayback((current) => current && index >= 0 && index < current.items.length
      ? { ...current, index, requestId: requestId.current } : current)
  }

  function removeQueuedItem(index) {
    setPlayback((current) => current && index > current.index
      ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)
  }

  function moveQueuedItem(index, direction) {
    setPlayback((current) => {
      const target = index + direction
      // Keep the current and already played tracks fixed while reordering what plays next.
      if (!current || index <= current.index || target <= current.index || target >= current.items.length) return current
      const items = [...current.items]
      const moved = items[index]
      items[index] = items[target]
      items[target] = moved
      return { ...current, items }
    })
  }

  function handleEnded() {
    if (playback && playback.index < playback.items.length - 1) nextTrack()
    else setIsPlaying(false)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div ref={sidebarRef} id="sidebar-navigation" className={menuOpen ? 'sidebar-shell open' : 'sidebar-shell'} role={menuOpen && isMobile ? 'dialog' : undefined} aria-label={menuOpen && isMobile ? 'Site navigation' : undefined} aria-modal={menuOpen && isMobile ? 'true' : undefined} aria-hidden={isMobile && !menuOpen}>
        <Sidebar />
      </div>
      {menuOpen && <button type="button" className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <div className="app-main">
        <Header onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} menuButtonRef={menuButtonRef} />
        <main id="main-content" tabIndex="-1" className={playback ? 'page-content has-player' : 'page-content'}><Outlet context={{ notify, playQueue, addToQueue, playback }} /></main>
      </div>
      {playback && <audio ref={audioRef} src={currentTrack.content_url} onPlay={() => { setIsPlaying(true); setPlayerError('') }} onPause={() => setIsPlaying(false)} onEnded={handleEnded} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={() => { setIsPlaying(false); setPlayerError('This browser cannot play this audio format. Download the track instead.') }} />}
      <MusicPlayer playback={playback} isPlaying={isPlaying} volume={volume} currentTime={currentTime} duration={duration} error={playerError} onToggle={togglePlayback} onPrevious={previousTrack} onNext={nextTrack} onVolumeChange={setVolume} onSeek={seekTo} onSelectQueueItem={selectQueueItem} onRemoveQueuedItem={removeQueuedItem} onMoveQueuedItem={moveQueuedItem} onClose={stopPlayback} />
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end><House size={20} /><span>Home</span></NavLink>
        <NavLink to="/music"><Music2 size={20} /><span>Music</span></NavLink>
        <NavLink to="/games"><Gamepad2 size={20} /><span>Games</span></NavLink>
        <NavLink to="/books"><BookOpen size={20} /><span>Books</span></NavLink>
        <NavLink to="/search"><Search size={20} /><span>Search</span></NavLink>
      </nav>
      {toast && <div className={playback ? 'toast toast-with-player' : 'toast'} role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
    </div>
  )
}
