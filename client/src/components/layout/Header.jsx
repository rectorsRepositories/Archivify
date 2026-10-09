import { Menu, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'

export default function Header({ onMenu, menuOpen, menuButtonRef }) {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const sectionTitle = location.pathname.startsWith('/music/albums/') ? 'Album details' : location.pathname.startsWith('/music') ? 'Music library' : location.pathname.startsWith('/games') ? 'Games library' : /^\/books\/[^/]+\/read$/.test(location.pathname) ? 'Book reader' : location.pathname.startsWith('/books') ? 'Books library' : location.pathname.startsWith('/search') ? 'Search archive' : location.pathname.startsWith('/downloads') ? 'Downloads' : 'Collection overview'

  function onSubmit(event) {
    event.preventDefault()
    const value = search.trim()
    if (!value) return
    navigate(`/search?search=${encodeURIComponent(value)}`)
    setSearch('')
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button ref={menuButtonRef} type="button" className="icon-button mobile-menu-button" onClick={onMenu} aria-label="Open menu" aria-controls="sidebar-navigation" aria-expanded={menuOpen}><Menu size={20} /></button>
        <div className="header-title"><span className="header-overline">YOUR PERSONAL ARCHIVE</span><strong>{sectionTitle}</strong></div>
      </div>
      <div className="topbar-right">
        <form className="global-search" onSubmit={onSubmit} role="search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your archive..." aria-label="Search entire archive" />
          <kbd>↵</kbd>
        </form>
      </div>
    </header>
  )
}
