import { Search, X } from 'lucide-react'
import { useId } from 'react'

export default function SearchBar({ value, onChange, placeholder, label }) {
  const id = useId()
  return (
    <div className="search-field">
      <Search size={18} aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={16} /></button>}
    </div>
  )
}
