import { Bell, Menu, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'

export default function Header({ notify, onMenu }) {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const sectionTitle = location.pathname.startsWith('/music/albums/') ? 'Album details' : location.pathname.startsWith('/music') ? 'Music library' : location.pathname.startsWith('/games') ? 'Games library' : 'Collection overview'

  function onSubmit(event) {
    event.preventDefault()
    const value = search.trim()
    if (!value) return
    navigate(`/music?search=${encodeURIComponent(value)}`)
    setSearch('')
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="icon-button mobile-menu-button" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
        <div className="header-title"><span className="header-overline">YOUR PERSONAL ARCHIVE</span><strong>{sectionTitle}</strong></div>
      </div>
      <div className="topbar-right">
        <form className="global-search" onSubmit={onSubmit} role="search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your archive..." aria-label="Search music" />
          <kbd>↵</kbd>
        </form>
        <button type="button" className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('You are all caught up')}><Bell size={19} /></button>
        <div className="avatar" title="Local profile">A</div>
      </div>
    </header>
  )
}
