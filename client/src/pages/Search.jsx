import { Disc3, Download, FileSearch, Gamepad2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import SearchBar from '../components/common/SearchBar.jsx'
import AlbumGrid from '../components/music/AlbumGrid.jsx'
import GameGrid from '../components/games/GameGrid.jsx'
import PagedFooter from '../components/common/PagedFooter.jsx'
import { listAlbums } from '../api/music.js'
import { listGames } from '../api/games.js'
import { listFiles } from '../api/files.js'
import { formatBytes } from '../api/format.js'
import useDebouncedValue from '../hooks/useDebouncedValue.js'
import usePagedResults from '../hooks/usePagedResults.js'

function ResultSection({ title, icon: Icon, results, children }) {
  return (
    <section className="search-results-section">
      <div className="results-heading"><h2><Icon size={19} /> {title} <span>{results.total}</span></h2><p>{results.items.length} shown</p></div>
      {results.loading ? <div className="search-loading">Searching {title.toLowerCase()}…</div> : results.error && !results.items.length ? <div className="empty-state"><h3>Could not search {title.toLowerCase()}</h3><p>{results.error}</p><button type="button" className="secondary-button" onClick={results.retry}>Try again</button></div> : results.items.length ? <>{children}<PagedFooter shown={results.items.length} total={results.total} hasMore={results.hasMore} loadingMore={results.loadingMore} error={results.error} onLoadMore={results.loadMore} /></> : <div className="search-no-results">No {title.toLowerCase()} match this search.</div>}
    </section>
  )
}

function SearchMatches({ query }) {
  const albums = usePagedResults(listAlbums, { q: query, sort: 'title' }, 8)
  const games = usePagedResults(listGames, { q: query, sort: 'title' }, 8)
  const files = usePagedResults(listFiles, { q: query }, 12)

  return (
    <div className="search-results-stack">
      <ResultSection title="Albums" icon={Disc3} results={albums}><AlbumGrid albums={albums.items} /></ResultSection>
      <ResultSection title="Games" icon={Gamepad2} results={games}><GameGrid games={games.items} /></ResultSection>
      <ResultSection title="Files" icon={FileSearch} results={files}>
        <div className="file-results">{files.items.map((file) => <div className="file-result" key={file.id}><div><strong>{file.filename}</strong><small>{file.category} · {file.relative_path} · {formatBytes(file.size_bytes)}</small></div><a href={file.download_url} className="secondary-button" aria-label={'Download ' + file.filename}><Download size={16} /> Download</a></div>)}</div>
      </ResultSection>
    </div>
  )
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const query = useDebouncedValue(search.trim())

  function setSearch(value) {
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    setParams(next, { replace: true })
  }

  return (
    <div className="library-page page-stack">
      <div className="page-heading"><div><span className="eyebrow">FIND WHAT YOU KEPT</span><h1>Search archive<span className="heading-dot">.</span></h1><p>Search albums, games, and indexed files in one place.</p></div></div>
      <div className="library-toolbar"><SearchBar value={search} onChange={setSearch} placeholder="Search your archive..." label="Search the entire archive" /></div>
      {query ? <SearchMatches key={query} query={query} /> : <div className="empty-state"><FileSearch size={36} /><h3>Everything is close at hand</h3><p>Enter a title, artist, platform, or filename to search the archive.</p></div>}
    </div>
  )
}
