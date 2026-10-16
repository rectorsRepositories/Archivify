import GameCard from './GameCard.jsx'

export default function GameGrid({ games, compact = false }) {
  return (
    <div className={`game-grid${compact ? ' compact-grid' : ''}`}>
      {games.map((game) => (
        <GameCard key={game.id} game={game} compact={compact} />
      ))}
    </div>
  )
}
