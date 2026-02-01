import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { initializeSocket, joinLobby, leaveLobby, getSocket, type MatchedData } from '../utils/socket'

interface LobbyProps {
  token: string
  onLogout: () => void
}

function Lobby({ token, onLogout }: LobbyProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'searching' | 'matched'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    // Initialize socket connection
    const socket = initializeSocket(token)

    // Listen for lobby events
    socket.on('lobby:waiting', () => {
      setStatus('searching')
      setError('')
    })

    socket.on('lobby:matched', (data: MatchedData) => {
      setStatus('matched')
      setError('')
      
      // Navigate to game with PvP state
      setTimeout(() => {
        navigate('/game', {
          state: {
            pvp: true,
            gameId: data.gameId,
            playerNumber: data.playerNumber,
            opponentUsername: data.opponentUsername,
            gameState: data.gameState
          }
        })
      }, 1000)
    })

    socket.on('lobby:left', () => {
      setStatus('idle')
    })

    socket.on('connect_error', (err) => {
      setError(`Connection error: ${err.message}`)
      setStatus('idle')
    })

    return () => {
      // Clean up listeners
      socket.off('lobby:waiting')
      socket.off('lobby:matched')
      socket.off('lobby:left')
      socket.off('connect_error')
      
      // Leave lobby if searching
      if (status === 'searching') {
        leaveLobby()
      }
    }
  }, [token, navigate, status])

  const handleFindMatch = () => {
    try {
      joinLobby()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join lobby')
    }
  }

  const handleCancel = () => {
    try {
      leaveLobby()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave lobby')
    }
  }

  return (
    <div className="game-page">
      <div className="nav-bar">
        <h1>ONITAMA</h1>
        <div className="nav-links">
          <Link to="/game">Play vs AI</Link>
          <Link to="/lobby">Multiplayer</Link>
          <Link to="/how-to-play">How to Play</Link>
          <Link to="/leaderboard">Leaderboard</Link>
          <button onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="container">
        {error && <div className="error">{error}</div>}

        <div style={{
          padding: '40px',
          border: '2px solid #444',
          borderRadius: '8px',
          backgroundColor: '#2a2a2a',
          textAlign: 'center',
          marginTop: '50px'
        }}>
        {status === 'idle' && (
          <>
            <h2 style={{ color: '#ff6b6b', marginBottom: '20px' }}>Find an Opponent</h2>
            <p style={{ margin: '20px 0', color: '#888' }}>
              Click the button below to join the matchmaking queue.<br />
              You'll be matched with another online player.
            </p>
            <button
              onClick={handleFindMatch}
              className="btn"
              style={{ maxWidth: '300px', margin: '0 auto' }}
            >
              Find Match
            </button>
          </>
        )}

        {status === 'searching' && (
          <>
            <h2 style={{ color: '#ff6b6b', marginBottom: '20px' }}>Searching for Opponent...</h2>
            <div style={{ margin: '30px 0' }}>
              <div style={{
                display: 'inline-block',
                width: '50px',
                height: '50px',
                border: '5px solid #444',
                borderTop: '5px solid #ff6b6b',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
            </div>
            <p style={{ color: '#888', marginBottom: '20px' }}>
              Waiting for another player to join...
            </p>
            <button
              onClick={handleCancel}
              className="btn btn-secondary"
              style={{ maxWidth: '300px', margin: '0 auto' }}
            >
              Cancel Search
            </button>
          </>
        )}

        {status === 'matched' && (
          <>
            <h2 style={{ color: '#4CAF50', marginBottom: '20px' }}>Match Found! 🎉</h2>
            <p style={{ margin: '20px 0', fontSize: '18px', color: '#f0f0f0' }}>
              Starting game...
            </p>
          </>
        )}
      </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default Lobby
