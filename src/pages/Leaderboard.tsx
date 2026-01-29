import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface LeaderboardProps {
  token: string | null
  onLogout: () => void
}

function Leaderboard({ token, onLogout }: LeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeaderboard()
  }, [])

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/leaderboard')
      const data = await response.json()
      setLeaderboard(data.leaderboard)
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="leaderboard-page">
      <div className="nav-bar">
        <h1>ONITAMA</h1>
        <div className="nav-links">
          <Link to="/game">Game</Link>
          <Link to="/how-to-play">How to Play</Link>
          <Link to="/leaderboard">Leaderboard</Link>
          {token && <button onClick={onLogout}>Logout</button>}
        </div>
      </div>

      <div className="container">
        <h2 style={{ marginBottom: '20px', color: '#ff6b6b' }}>Leaderboard</h2>

        {loading ? (
          <div className="loading">Loading leaderboard...</div>
        ) : (
          <div className="leaderboard">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Games</th>
                  <th>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>
                      No players yet. Be the first!
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((player, index) => (
                    <tr key={player.username}>
                      <td className="rank">#{index + 1}</td>
                      <td>{player.username}</td>
                      <td>{player.wins}</td>
                      <td>{player.losses}</td>
                      <td>{player.gamesPlayed}</td>
                      <td>{player.winRate}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Leaderboard
