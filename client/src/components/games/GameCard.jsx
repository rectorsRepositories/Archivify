import { Download, Gamepad2 } from 'lucide-react'
import { formatBytes } from '../../api/format.js'

export default function GameCard({ game, compact = false }) {
  const details = [game.is_complete === false ? 'Incomplete' : null,
    game.disc_count > 1 ? `${game.disc_count} discs` : null,
    game.genre, game.release_year, formatBytes(game.size_bytes)].filter(Boolean)
  return (
    <article className={`game-card${compact ? ' compact' : ''}`}>
      <div className="game-art-frame">{game.artwork_url ? <img src={game.artwork_url} alt={`${game.title} cover art`} loading="lazy" /> : <div className="game-art-placeholder" aria-label="No cover art available"><Gamepad2 size={48} /></div>}<span className="game-platform">{game.platform}</span></div>
      <div className="game-info"><div><h3 title={game.title}>{game.title}</h3><p>{details.join(' · ')}</p></div>{game.is_complete === false ? <span aria-label={`${game.title} is incomplete`} title="A required file is no longer indexed"><Download size={17} /></span> : <a href={game.download_url} aria-label={`Download ${game.title}${game.disc_count > 1 ? `, all ${game.disc_count} discs` : ''}`} title={`Download ${game.title}${game.file_count > 1 ? ' (complete ZIP)' : ''}`}><Download size={17} /></a>}</div>
    </article>
  )
}
