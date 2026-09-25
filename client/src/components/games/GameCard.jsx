import { Download } from 'lucide-react'

export default function GameCard({ game, notify, compact = false }) {
  return (
    <article className={`game-card${compact ? ' compact' : ''}`}>
      <div className="game-art-frame"><img src={game.art} alt={`${game.title} game artwork`} loading="lazy" /><span className="game-platform">{game.platform}</span></div>
      <div className="game-info"><div><h3>{game.title}</h3><p>{game.genre} <i /> {game.year}</p></div><button type="button" aria-label={`Download ${game.title}`} title={`Download ${game.title}`} onClick={() => notify('Game downloads are coming soon')}><Download size={17} /></button></div>
    </article>
  )
}
