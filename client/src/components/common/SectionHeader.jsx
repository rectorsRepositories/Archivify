import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SectionHeader({ title, subtitle, to, action = 'View all' }) {
  return (
    <div className="section-header">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {to && <Link to={to} className="text-link">{action}<ArrowRight size={16} /></Link>}
    </div>
  )
}
