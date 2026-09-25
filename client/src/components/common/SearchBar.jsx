import { Search, X } from 'lucide-react'

export default function SearchBar({ value, onChange, placeholder, label }) {
  return (
    <label className="search-field">
      <Search size={18} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={16} /></button>}
    </label>
  )
}
