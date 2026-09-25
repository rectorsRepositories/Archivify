export default function FilterBar({ options, value, onChange, label }) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" className={`filter-chip${value === option ? ' selected' : ''}`} key={option} onClick={() => onChange(option)} aria-pressed={value === option}>
          {option}
        </button>
      ))}
    </div>
  )
}
