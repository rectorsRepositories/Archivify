import { Archive, Download, Gamepad2, HardDrive, House, Music2, Search } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const mainNav = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/music', label: 'Music', icon: Music2 },
  { to: '/games', label: 'Games', icon: Gamepad2 },
  { to: '/search', label: 'Search', icon: Search },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Archive home">
        <span className="brand-mark"><Archive size={23} strokeWidth={2.3} /></span>
        <span className="brand-copy"><strong>archivify<span className="brand-dot">.</span></strong><small>YOUR SPACE, FOREVER</small></span>
      </NavLink>

      <div className="sidebar-nav-wrap">
        <div className="nav-group-label">LIBRARY</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {mainNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={label} title={label} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="nav-group-label tools-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <NavLink to="/downloads" aria-label="Downloads" title="Downloads" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Download size={18} strokeWidth={1.9} /><span>Downloads</span>
          </NavLink>
        </nav>
      </div>

      <div className="sidebar-bottom">
        <div className="server-card">
          <span className="server-icon"><HardDrive size={19} /></span>
          <span><strong>Home server</strong><small>Local archive API</small></span>
        </div>
        <p>Made for everything<br />you want to keep.</p>
      </div>
    </aside>
  )
}
