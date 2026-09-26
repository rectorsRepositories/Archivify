import { Download, Gamepad2 } from 'lucide-react'
import { formatBytes } from '../../api/format.js'

export default function GameCard({ game, compact = false }) {
  const details = [game.genre, game.release_year, formatBytes(game.size_bytes)].filter(Boolean)
  return (
    <article className={`game-card${compact ? ' compact' : ''}`}>
      <div className="game-art-frame">{game.artwork_url ? <img src={game.artwork_url} alt={`${game.title} cover art`} loading="lazy" /> : <div className="game-art-placeholder" aria-label="No cover art available"><Gamepad2 size={48} /></div>}<span className="game-platform">{game.platform}</span></div>
      <div className="game-info"><div><h3 title={game.title}>{game.title}</h3><p>{details.join(' · ')}</p></div><a href={game.download_url} aria-label={`Download ${game.title}`} title={`Download ${game.filename}`}><Download size={17} /></a></div>
    </article>
  )
}
