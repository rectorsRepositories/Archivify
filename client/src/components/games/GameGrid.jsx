import GameCard from './GameCard.jsx'

export default function GameGrid({ games: items, compact = false }) {
  return <div className={`game-grid${compact ? ' compact-grid' : ''}`}>{items.map((game) => <GameCard key={game.id} game={game} compact={compact} />)}</div>
}
