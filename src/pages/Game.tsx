/// <reference types="react" />
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CARD_MOVES } from '../utils/cards'

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
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [validMoves, setValidMoves] = useState<ValidMove[]>([])
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval)
    }
  }, [pollingInterval])

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
    console.log('handlePieceClick called with:', pieceIndex)
    console.log('gameState:', gameState?.currentPlayer, 'winner:', gameState?.winner)
    
    if (!gameState || gameState.winner || gameState.currentPlayer !== 1) {
      console.log('Cannot select piece - conditions not met')
      return
    }
    if (pieceIndex < 0) {
      console.log('Invalid piece index')
      return
    }
    
    // Toggle selection if clicking same piece
    if (selectedPiece === pieceIndex) {
      console.log('Deselecting piece')
      setSelectedPiece(null)
      setValidMoves([])
      setSelectedCard(null)
      return
    }
    
    console.log('Selecting piece:', pieceIndex, 'selectedCard:', selectedCard)
    setSelectedPiece(pieceIndex)
    
    // Calculate all valid moves for this piece using any available card
    calculateAllValidMoves(pieceIndex)
  }

  const handleCardClick = (cardName: string) => {
    console.log('handleCardClick called with:', cardName)
    
    if (!gameState || gameState.winner || gameState.currentPlayer !== 1) {
      console.log('Cannot select card - conditions not met')
      return
    }
    
    // Toggle selection if clicking same card
    if (selectedCard === cardName) {
      console.log('Deselecting card')
      setSelectedCard(null)
      // If piece is still selected, show all valid moves
      if (selectedPiece !== null) {
        calculateAllValidMoves(selectedPiece)
      } else {
        setValidMoves([])
      }
      return
    }
    
    console.log('Selecting card:', cardName, 'selectedPiece:', selectedPiece)
    setSelectedCard(cardName)
    
    // Calculate valid moves if piece is selected
    if (selectedPiece !== null) {
      calculateValidMoves(selectedPiece, cardName)
    }
  }

  const calculateValidMoves = (pieceIndex: number, cardName: string) => {
    const piece = gameState.pieces[1][pieceIndex]
    if (!piece) return

    const moves = CARD_MOVES[cardName] || []
    const valid: ValidMove[] = []

    moves.forEach(([dRow, dCol]: [number, number]) => {
      // Player 1 at bottom (row 4) moving toward opponent at top (row 0)
      // Need to negate row: positive card values mean "forward toward opponent"
      // which means decreasing row numbers for player 1
      // Column: positive = right, negative = left (same for all players)
      const newRow = piece.row - dRow
      const newCol = piece.col + dCol

      console.log(`Card ${cardName}, piece at [${piece.row},${piece.col}], move [${dRow},${dCol}] -> [${newRow},${newCol}]`)

      // Check bounds
      if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) {
        console.log('  Out of bounds')
        return
      }

      // Check if destination has own piece
      const destPiece = gameState.board[newRow][newCol]
      if (destPiece && destPiece.player === 1) {
        console.log('  Own piece')
        return
      }

      console.log('  Valid!')
      valid.push({ row: newRow, col: newCol, cardName })
    })

    setValidMoves(valid)
  }

  const calculateAllValidMoves = (pieceIndex: number) => {
    const piece = gameState.pieces[1][pieceIndex]
    if (!piece) return

    console.log('Calculating moves for piece', pieceIndex, 'at position', piece.row, piece.col)
    console.log('Available cards:', gameState.player1Cards)

    const allValid: ValidMove[] = []

    // Calculate moves for all available cards
    gameState.player1Cards.forEach((cardName: string) => {
      const moves = CARD_MOVES[cardName] || []
      console.log(`Card ${cardName} moves:`, moves)
      
      moves.forEach(([dRow, dCol]: [number, number]) => {
        // Negate row (toward opponent), keep col as-is (right = positive)
        const newRow = piece.row - dRow
        const newCol = piece.col + dCol
        console.log(`  Move [${dRow},${dCol}] -> [${newRow},${newCol}]`)

        // Check bounds
        if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) {
          console.log('    Rejected: out of bounds')
          return
        }

        // Check if destination has own piece
        const destPiece = gameState.board[newRow][newCol]
        if (destPiece && destPiece.player === 1) {
          console.log('    Rejected: own piece')
          return
        }

        console.log('    Accepted!')
        // Check if this move is already in the list
        if (!allValid.some(m => m.row === newRow && m.col === newCol)) {
          allValid.push({ row: newRow, col: newCol, cardName })
        }
      })
    })

    console.log('Valid moves:', allValid)
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
    try {
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
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
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const cellPiece = gameState.board[row][col]
        const isTemple = (row === 0 && col === 2) || (row === 4 && col === 2)
        const isValidMove = validMoves.some(m => m.row === row && m.col === col)
        
        // Check if this cell contains the selected piece
        let isSelectedPiece = false
        if (selectedPiece !== null && gameState.pieces[1][selectedPiece]) {
          const piece = gameState.pieces[1][selectedPiece]
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
                className={`piece player${cellPiece.player} ${cellPiece.type} ${isSelectedPiece ? 'selected' : ''}`}
                onClick={(e) => {
                  // Only handle clicks on own pieces to select them
                  // Let opponent pieces fall through to cell click for captures
                  if (cellPiece.player === 1) {
                    e.stopPropagation()
                    const pieceIndex = gameState.pieces[1].findIndex(
                      (p: Piece) => p.row === row && p.col === col
                    )
                    console.log('Clicked piece:', pieceIndex, 'at', row, col)
                    handlePieceClick(pieceIndex)
                  }
                  // For player 2 pieces, let the click bubble to handleCellClick for captures
                }}
              />
            )}
          </div>
        )
      }
    }

    return <div className="board">{cells}</div>
  }

  return (
    <div className="game-page">
      <div className="nav-bar">
        <h1>ONITAMA</h1>
        <div className="nav-links">
          <Link to="/game">Game</Link>
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
                  {gameState.winner === 1 ? '🎉 You Won!' : '😔 AI Won'}
                </h2>
                <p>Victory by {gameState.winCondition}</p>
              </div>
            )}

            <div className="game-header">
              <div className="game-info-compact">
                <div className="turn-indicator">
                  <strong>Turn:</strong> {gameState.currentPlayer === 1 ? 'You (Green)' : 'AI (Red)'}
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
                <button type="button" className="btn-small" onClick={() => startNewGame('medium')}>
                  New Game
                </button>
                {!gameState.winner && (
                  <button type="button" className="btn-small btn-secondary" onClick={handleResign}>
                    Resign
                  </button>
                )}
              </div>
            </div>

            <div className="game-layout">
              <div className="main-game-area">
                <div className="ai-cards-row">
                  <h3>AI Cards</h3>
                  <div className="cards-horizontal">
                    {gameState.player2Cards.map((card: string) => 
                      renderCard(card, false, false)
                    )}
                  </div>
                </div>

                <div className="board-with-side">
                  <div className="captured-pieces-left">
                    <div className="captured-section">
                      <h4>AI Captured</h4>
                      <div className="captured-list">
                        {gameState.pieces[1].length < 5 && 
                          Array(5 - gameState.pieces[1].length).fill(0).map((_, i) => (
                            <div key={i} className="captured-piece player1">🥋</div>
                          ))
                        }
                      </div>
                    </div>
                    <div className="captured-section">
                      <h4>You Captured</h4>
                      <div className="captured-list">
                        {gameState.pieces[2].length < 5 && 
                          Array(5 - gameState.pieces[2].length).fill(0).map((_, i) => (
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
                    {gameState.player1Cards.map((card: string) => 
                      renderCard(card, !gameState.winner && gameState.currentPlayer === 1, card === selectedCard)
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
