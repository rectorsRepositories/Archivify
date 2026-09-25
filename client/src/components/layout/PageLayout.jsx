import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Gamepad2, House, Menu, Music2, X } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'

export default function PageLayout() {
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const notify = (message) => setToast(message)

  return (
    <div className="app-shell">
      <div className={menuOpen ? 'sidebar-shell open' : 'sidebar-shell'}>
        <Sidebar notify={notify} />
      </div>
      {menuOpen && <button type="button" className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <div className="app-main">
        <Header notify={notify} onMenu={() => setMenuOpen(true)} />
        <main className="page-content"><Outlet context={{ notify }} /></main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end><House size={20} /><span>Home</span></NavLink>
        <NavLink to="/music"><Music2 size={20} /><span>Music</span></NavLink>
        <NavLink to="/games"><Gamepad2 size={20} /><span>Games</span></NavLink>
        <button type="button" onClick={() => setMenuOpen(true)}><Menu size={20} /><span>More</span></button>
      </nav>
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
    </div>
  )
}
