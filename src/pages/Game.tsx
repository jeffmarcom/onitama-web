import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CARD_MOVES } from '../utils/cards'
import { initializeSocket, getSocket, makeMove as socketMakeMove } from '../utils/socket'

const DEBUG = import.meta.env.DEV
const debug = (...args: unknown[]): void => { if (DEBUG) console.log(...args) }

export interface Piece {
  row: number
  col: number
  player: 1 | 2
  type: 'master' | 'student'
}

export interface ValidMove {
  row: number
  col: number
  cardName: string
}

export interface GameState {
  id: string
  pieces: { 1: Piece[]; 2: Piece[] }
  board: (Piece | null)[][]
  player1Cards: string[]
  player2Cards: string[]
  sideCard: string
  currentPlayer: 1 | 2
  winner: 1 | 2 | null
  winCondition?: string
}

export interface User {
  username: string
}

interface GameProps {
  token: string
  user: User | null
  onLogout: () => void
}

function Game({ token, user, onLogout }: GameProps) {
  const location = useLocation()
  const pvpState = location.state as { pvp?: boolean; gameId?: string; playerNumber?: 1 | 2; opponentUsername?: string; gameState?: GameState } | null
  
  const [gameState, setGameState] = useState<GameState | null>(pvpState?.gameState || null)
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [validMoves, setValidMoves] = useState<ValidMove[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null)
  
  // PvP specific state
  const [isPvP, setIsPvP] = useState(pvpState?.pvp || false)
  const [playerNumber, setPlayerNumber] = useState<1 | 2 | null>(pvpState?.playerNumber || null)
  const [opponentUsername, setOpponentUsername] = useState<string>(pvpState?.opponentUsername || '')
  const [opponentDisconnected, setOpponentDisconnected] = useState(false)

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval)
    }
  }, [pollingInterval])

  // Socket effect for PvP games
  useEffect(() => {
    if (!isPvP || !token) return

    const socket = initializeSocket(token)

    // Listen for game state updates
    socket.on('game:state', ({ gameState: newState }) => {
      setGameState(newState)
      // Clear selection after move
      setSelectedPiece(null)
      setSelectedCard(null)
      setValidMoves([])
    })

    // Listen for errors
    socket.on('game:error', ({ error: errorMsg }) => {
      setError(errorMsg)
      setLoading(false)
    })

    // Listen for opponent disconnect
    socket.on('game:opponent_disconnected', ({ username }) => {
      setOpponentDisconnected(true)
      setError(`${username} has disconnected. You win by default.`)
    })

    return () => {
      socket.off('game:state')
      socket.off('game:error')
      socket.off('game:opponent_disconnected')
    }
  }, [isPvP, token])

  const startNewGame = async (difficulty: string = 'medium') => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/game/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ difficulty })
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error)

      setGameState(data.gameState)
      setSelectedPiece(null)
      setSelectedCard(null)
      setValidMoves([])
      
      // Start polling for AI moves
      const interval = setInterval(() => pollGameState(data.gameId), 1000)
      setPollingInterval(interval)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const pollGameState = async (gameId: string) => {
    try {
      const response = await fetch(`/api/game/${gameId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setGameState(data.gameState)
      }
    } catch (err) {
      console.error('Poll error:', err)
    }
  }

  const handlePieceClick = (pieceIndex: number) => {
    debug('handlePieceClick called with:', pieceIndex)
    debug('gameState:', gameState?.currentPlayer, 'winner:', gameState?.winner)

    const myPlayerNumber = isPvP ? playerNumber : 1
    if (!gameState || gameState.winner || gameState.currentPlayer !== myPlayerNumber) {
      debug('Cannot select piece - conditions not met')
      return
    }
    if (pieceIndex < 0) {
      debug('Invalid piece index')
      return
    }

    // Toggle selection if clicking same piece
    if (selectedPiece === pieceIndex) {
      debug('Deselecting piece')
      setSelectedPiece(null)
      setValidMoves([])
      setSelectedCard(null)
      return
    }

    debug('Selecting piece:', pieceIndex, 'selectedCard:', selectedCard)
    setSelectedPiece(pieceIndex)
    
    // Calculate all valid moves for this piece using any available card
    calculateAllValidMoves(pieceIndex)
  }

  const handleCardClick = (cardName: string) => {
    debug('handleCardClick called with:', cardName)

    const myPlayerNumber = isPvP ? playerNumber : 1
    if (!gameState || gameState.winner || gameState.currentPlayer !== myPlayerNumber) {
      debug('Cannot select card - conditions not met')
      return
    }

    // Toggle selection if clicking same card
    if (selectedCard === cardName) {
      debug('Deselecting card')
      setSelectedCard(null)
      // If piece is still selected, show all valid moves
      if (selectedPiece !== null) {
        calculateAllValidMoves(selectedPiece)
      } else {
        setValidMoves([])
      }
      return
    }

    debug('Selecting card:', cardName, 'selectedPiece:', selectedPiece)
    setSelectedCard(cardName)
    
    // Calculate valid moves if piece is selected
    if (selectedPiece !== null) {
      calculateValidMoves(selectedPiece, cardName)
    }
  }

  const calculateValidMoves = (pieceIndex: number, cardName: string) => {
    const myPlayerNumber = isPvP ? (playerNumber || 1) : 1
    const piece = gameState.pieces[myPlayerNumber][pieceIndex]
    if (!piece) return

    const moves = CARD_MOVES[cardName] || []
    const valid: ValidMove[] = []

    moves.forEach(([dRow, dCol]: [number, number]) => {
      // Player 1 at bottom (row 4) moving toward opponent at top (row 0)
      // Player 2 at top (row 0) moving toward opponent at bottom (row 4)
      // Card moves: positive dRow = forward, negative dRow = backward
      // positive dCol = right, negative dCol = left (from player's perspective)
      let newRow, newCol
      if (myPlayerNumber === 1) {
        newRow = piece.row - dRow  // Forward = decreasing row
        newCol = piece.col + dCol  // Right = increasing col
      } else {
        newRow = piece.row + dRow  // Forward = increasing row for player 2
        newCol = piece.col - dCol  // Right is flipped for player 2
      }

      debug(`Card ${cardName}, piece at [${piece.row},${piece.col}], move [${dRow},${dCol}] -> [${newRow},${newCol}]`)

      // Check bounds
      if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) {
        debug('  Out of bounds')
        return
      }

      // Check if destination has own piece
      const destPiece = gameState.board[newRow][newCol]
      if (destPiece && destPiece.player === myPlayerNumber) {
        debug('  Own piece')
        return
      }

      debug('  Valid!')
      valid.push({ row: newRow, col: newCol, cardName })
    })

    setValidMoves(valid)
  }

  const calculateAllValidMoves = (pieceIndex: number) => {
    const myPlayerNumber = isPvP ? (playerNumber || 1) : 1
    const piece = gameState.pieces[myPlayerNumber][pieceIndex]
    if (!piece) return

    const myCards = myPlayerNumber === 1 ? gameState.player1Cards : gameState.player2Cards
    debug('Calculating moves for piece', pieceIndex, 'at position', piece.row, piece.col)
    debug('Available cards:', myCards)

    const allValid: ValidMove[] = []

    // Calculate moves for all available cards
    myCards.forEach((cardName: string) => {
      const moves = CARD_MOVES[cardName] || []
      debug(`Card ${cardName} moves:`, moves)

      moves.forEach(([dRow, dCol]: [number, number]) => {
        // Calculate new position based on player perspective
        let newRow, newCol
        if (myPlayerNumber === 1) {
          newRow = piece.row - dRow  // Forward = decreasing row
          newCol = piece.col + dCol  // Right = increasing col
        } else {
          newRow = piece.row + dRow  // Forward = increasing row for player 2
          newCol = piece.col - dCol  // Right is flipped for player 2
        }
        debug(`  Move [${dRow},${dCol}] -> [${newRow},${newCol}]`)

        // Check bounds
        if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) {
          debug('    Rejected: out of bounds')
          return
        }

        // Check if destination has own piece
        const destPiece = gameState.board[newRow][newCol]
        if (destPiece && destPiece.player === myPlayerNumber) {
          debug('    Rejected: own piece')
          return
        }

        debug('    Accepted!')
        // Check if this move is already in the list
        if (!allValid.some(m => m.row === newRow && m.col === newCol)) {
          allValid.push({ row: newRow, col: newCol, cardName })
        }
      })
    })

    debug('Valid moves:', allValid)
    setValidMoves(allValid)
  }

  const handleCellClick = async (row: number, col: number) => {
    if (!gameState || selectedPiece === null) return
    
    const move = validMoves.find(m => m.row === row && m.col === col)
    if (!move) return

    // Use selected card if available, otherwise use the card from the move
    const cardToUse = selectedCard || move.cardName
    if (!cardToUse) return

    setLoading(true)
    setError('')
    
    try {
      if (isPvP && gameState.id) {
        // PvP game: use socket
        socketMakeMove(gameState.id, selectedPiece, row, col, cardToUse)
        // Optimistically clear selection - state update will come via socket
        setSelectedPiece(null)
        setSelectedCard(null)
        setValidMoves([])
        setLoading(false)
      } else {
        // AI game: use HTTP
        const response = await fetch(`/api/game/${gameState.id}/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            pieceIndex: selectedPiece,
            toRow: row,
            toCol: col,
            cardName: cardToUse
          })
        })

        const data = await response.json()
        if (!response.ok) throw new Error(data.error)

        setGameState(data.gameState)
        setSelectedPiece(null)
        setSelectedCard(null)
        setValidMoves([])

        if (data.gameEnded && pollingInterval) {
          clearInterval(pollingInterval)
        }
        setLoading(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const handleResign = async () => {
    if (!gameState || !confirm('Are you sure you want to resign?')) return

    try {
      const response = await fetch(`/api/game/${gameState.id}/resign`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      setGameState(data.gameState)
      if (pollingInterval) clearInterval(pollingInterval)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const renderCard = (cardName: string, isSelectable: boolean, isSelected: boolean) => {
    const moves = CARD_MOVES[cardName] || []
    
    // Create 5x5 grid showing moves
    const grid = []
    for (let r = 2; r >= -2; r--) {
      for (let c = -2; c <= 2; c++) {
        const isMove = moves.some(([dr, dc]: [number, number]) => dr === r && dc === c)
        const isCurrent = r === 0 && c === 0
        grid.push(
          <div 
            key={`${r}-${c}`} 
            className={`card-grid-cell ${isCurrent ? 'current' : ''} ${isMove ? 'move' : ''}`}
          >
            {isCurrent && '◆'}
            {isMove && '●'}
          </div>
        )
      }
    }

    return (
      <div 
        className={`card ${isSelectable ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
        role={isSelectable ? 'button' : undefined}
        tabIndex={isSelectable ? 0 : undefined}
        aria-selected={isSelectable ? isSelected : undefined}
        onClick={isSelectable ? () => handleCardClick(cardName) : undefined}
        onKeyDown={isSelectable ? (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCardClick(cardName)
          }
        } : undefined}
      >
        <div className="card-name">{cardName}</div>
        <div className="card-grid">{grid}</div>
      </div>
    )
  }

  const renderBoard = () => {
    if (!gameState) return null

    const cells = []
    // If player 2, iterate in reverse to flip board perspective
    const rowStart = isPlayer2View ? 4 : 0
    const rowEnd = isPlayer2View ? -1 : 5
    const rowStep = isPlayer2View ? -1 : 1
    const colStart = isPlayer2View ? 4 : 0
    const colEnd = isPlayer2View ? -1 : 5
    const colStep = isPlayer2View ? -1 : 1
    
    for (let row = rowStart; row !== rowEnd; row += rowStep) {
      for (let col = colStart; col !== colEnd; col += colStep) {
        const cellPiece = gameState.board[row][col]
        const isTemple = (row === 0 && col === 2) || (row === 4 && col === 2)
        const isValidMove = validMoves.some(m => m.row === row && m.col === col)
        
        // Check if this cell contains the selected piece
        let isSelectedPiece = false
        if (selectedPiece !== null && gameState.pieces[myPlayerNumber][selectedPiece]) {
          const piece = gameState.pieces[myPlayerNumber][selectedPiece]
          isSelectedPiece = piece.row === row && piece.col === col
        }
        
        let cellClass = 'cell'
        if (isTemple) cellClass += ' temple'
        if (isValidMove) cellClass += ' valid-move'
        if (isSelectedPiece) cellClass += ' selected-piece'

        cells.push(
          <div 
            key={`${row}-${col}`} 
            className={cellClass}
            role="button"
            tabIndex={0}
            aria-selected={isSelectedPiece}
            onClick={() => handleCellClick(row, col)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleCellClick(row, col)
              }
            }}
          >
            {cellPiece && (
              <div 
                className={`piece player${cellPiece.player === myPlayerNumber ? '1' : '2'} ${cellPiece.type} ${isSelectedPiece ? 'selected' : ''}`}
                onClick={(e) => {
                  console.log('Piece clicked - cellPiece.player:', cellPiece.player, 'myPlayerNumber:', myPlayerNumber, 'isPvP:', isPvP, 'playerNumber:', playerNumber)
                  // Only handle clicks on own pieces to select them
                  // Let opponent pieces fall through to cell click for captures
                  if (cellPiece.player === myPlayerNumber) {
                    e.stopPropagation()
                    const pieceIndex = gameState.pieces[myPlayerNumber].findIndex(
                      (p: Piece) => p.row === row && p.col === col
                    )
                    debug('Clicked own piece:', pieceIndex, 'at', row, col)
                    handlePieceClick(pieceIndex)
                  } else {
                    console.log('Clicked opponent piece - should not select')
                  }
                  // For opponent pieces, let the click bubble to handleCellClick for captures
                }}
              />
            )}
          </div>
        )
      }
    }

    return <div className="board">{cells}</div>
  }

  const myPlayerNumber = isPvP ? (playerNumber || 1) : 1
  const isPlayer2View = myPlayerNumber === 2

  return (
    <div className="game-page">
      <div className="nav-bar">
        <h1>ONITAMA</h1>
        <div className="nav-links">
          <Link to="/game">Play vs AI</Link>
          <Link to="/lobby">Multiplayer</Link>
          <Link to="/how-to-play">How to Play</Link>
          <Link to="/leaderboard">Leaderboard</Link>
          <button type="button" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="container">
        {error && <div className="error">{error}</div>}

        {!gameState ? (
          <div style={{ textAlign: 'center', marginTop: '50px' }}>
            <h2>Welcome, {user?.username}!</h2>
            <p style={{ margin: '20px 0', color: '#888' }}>Start a new game to play</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button type="button" className="btn" onClick={() => startNewGame('easy')}>Easy</button>
              <button type="button" className="btn" onClick={() => startNewGame('medium')}>Medium</button>
              <button type="button" className="btn" onClick={() => startNewGame('hard')}>Hard</button>
            </div>
          </div>
        ) : (
          <>
            {gameState.winner && (
              <div className="winner-banner">
                <h2>
                  {gameState.winner === (isPvP ? playerNumber : 1) ? '🎉 You Won!' : `😔 ${isPvP ? opponentUsername : 'AI'} Won`}
                </h2>
                <p>Victory by {gameState.winCondition}</p>
              </div>
            )}
            {opponentDisconnected && (
              <div className="winner-banner" style={{ backgroundColor: '#ff9800' }}>
                <h2>⚠️ Opponent Disconnected</h2>
                <p>You win by default</p>
              </div>
            )}

            <div className="game-header">
              <div className="game-info-compact">
                {isPvP && (
                  <div className="pvp-info" style={{ marginBottom: '10px', fontSize: '16px' }}>
                    <strong>Playing against:</strong> {opponentUsername}
                  </div>
                )}
                <div className="turn-indicator">
                  <strong>Turn:</strong> {gameState.currentPlayer === (isPvP ? playerNumber : 1) ? 'You' : `${isPvP ? opponentUsername : 'AI'}`}
                </div>
                <div className="game-hint">
                  {selectedPiece !== null && validMoves.length > 0 ? 
                    'Click a highlighted square to move' : 
                    selectedPiece !== null ? 
                    'Click a card to filter moves (optional)' : 
                    'Select a piece to see valid moves'}
                </div>
              </div>
              <div className="game-controls-compact">
                {!isPvP && (
                  <button type="button" className="btn-small" onClick={() => startNewGame('medium')}>
                    New Game
                  </button>
                )}
                {!gameState.winner && !isPvP && (
                  <button type="button" className="btn-small btn-secondary" onClick={handleResign}>
                    Resign
                  </button>
                )}
              </div>
            </div>

            <div className="game-layout">
              <div className="main-game-area">
                <div className="ai-cards-row">
                  <h3>{isPvP ? `${opponentUsername}'s Cards` : 'AI Cards'}</h3>
                  <div className="cards-horizontal">
                    {(isPlayer2View ? gameState.player1Cards : gameState.player2Cards).map((card: string) => 
                      renderCard(card, false, false)
                    )}
                  </div>
                </div>

                <div className="board-with-side">
                  <div className="captured-pieces-left">
                    <div className="captured-section">
                      <h4>{isPvP ? `${opponentUsername} Captured` : 'AI Captured'}</h4>
                      <div className="captured-list">
                        {gameState.pieces[myPlayerNumber].length < 5 && 
                          Array(5 - gameState.pieces[myPlayerNumber].length).fill(0).map((_, i) => (
                            <div key={i} className="captured-piece player1">🥋</div>
                          ))
                        }
                      </div>
                    </div>
                    <div className="captured-section">
                      <h4>You Captured</h4>
                      <div className="captured-list">
                        {gameState.pieces[myPlayerNumber === 1 ? 2 : 1].length < 5 && 
                          Array(5 - gameState.pieces[myPlayerNumber === 1 ? 2 : 1].length).fill(0).map((_, i) => (
                            <div key={i} className="captured-piece player2">🥋</div>
                          ))
                        }
                      </div>
                    </div>
                  </div>
                  {renderBoard()}
                  <div className="side-card-container">
                    <h3>Side Card</h3>
                    {renderCard(gameState.sideCard, false, false)}
                  </div>
                </div>

                <div className="player-cards-row">
                  <h3>Your Cards</h3>
                  <div className="cards-horizontal">
                    {(isPlayer2View ? gameState.player2Cards : gameState.player1Cards).map((card: string) => 
                      renderCard(card, !gameState.winner && gameState.currentPlayer === (isPvP ? playerNumber : 1), card === selectedCard)
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Game
