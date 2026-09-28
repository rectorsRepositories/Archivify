import { Archive, Compass, Download, Gamepad2, HardDrive, House, Music2, Settings2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const mainNav = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/music', label: 'Music', icon: Music2 },
  { to: '/games', label: 'Games', icon: Gamepad2 },
]

const plannedNav = [
  { label: 'Browse', icon: Compass },
  { label: 'Downloads', icon: Download },
  { label: 'Settings', icon: Settings2 },
]

export default function Sidebar({ notify }) {
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
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="nav-group-label tools-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Planned sections">
          {plannedNav.map(({ label, icon: Icon }) => (
            <button className="nav-link nav-link-muted" type="button" key={label} onClick={() => notify(`${label} is coming soon`)}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span><span className="soon-dot" />
            </button>
          ))}
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
