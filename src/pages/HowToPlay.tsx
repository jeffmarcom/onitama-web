import { Link } from 'react-router-dom'
import { useState } from 'react'
import { CARD_MOVES } from '../utils/cards'

interface HowToPlayProps {
  onLogout: () => void
}

function HowToPlay({ onLogout }: HowToPlayProps) {
  const [tutorialStep, setTutorialStep] = useState(0)
  const [selectedDemoCard, setSelectedDemoCard] = useState<string | null>(null)

  const tutorialSteps = [
    {
      title: "Welcome to Onitama!",
      content: "Onitama is a two-player abstract strategy game. Your goal is to either capture your opponent's Master or move your Master to your opponent's temple.",
      visual: "intro"
    },
    {
      title: "The Board",
      content: "The game is played on a 5x5 board. Each player starts with 5 pieces: 1 Master (👑) in the center and 4 Students (🥋) on either side. The temples (⛩) are the center squares on each player's back row.",
      visual: "board"
    },
    {
      title: "Movement Cards",
      content: "Each player has 2 movement cards that show how pieces can move. Cards display a grid where the center (◆) represents your piece's current position, and dots (●) show where you can move. There's also a 5th card on the side that neither player can use yet.",
      visual: "cards"
    },
    {
      title: "Making a Move",
      content: "On your turn: Select one of your pieces to see all valid moves highlighted on the board. You can optionally click a card to see only moves for that card. Click a highlighted square to move there.",
      visual: "move"
    },
    {
      title: "Card Rotation",
      content: "After you move, the card you used goes to the side, and you take the card that was on the side. This means your available moves constantly change throughout the game!",
      visual: "rotation"
    },
    {
      title: "Capturing Pieces",
      content: "If you move onto a square occupied by an opponent's piece, you capture it and remove it from the game. Captured pieces are shown on the left side of the board.",
      visual: "capture"
    },
    {
      title: "Winning the Game",
      content: "There are two ways to win: Way of the Stone - Capture your opponent's Master (👑), or Way of the Stream - Move your Master to your opponent's temple (the center square on their back row).",
      visual: "winning"
    },
    {
      title: "Strategy Tips",
      content: "• Protect your Master with Students\n• Watch which cards your opponent has\n• Plan ahead - remember the card you use will go to your opponent next turn\n• Control the center of the board\n• Look for capture opportunities but don't leave your Master exposed!",
      visual: "tips"
    }
  ]

  const nextStep = () => {
    if (tutorialStep < tutorialSteps.length - 1) {
      setTutorialStep(tutorialStep + 1)
    }
  }

  const prevStep = () => {
    if (tutorialStep > 0) {
      setTutorialStep(tutorialStep - 1)
    }
  }

  const renderCard = (cardName: string, isDemo: boolean = false) => {
    const moves = CARD_MOVES[cardName] || []
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
      <div className={`card ${isDemo ? 'demo-card' : ''}`}>
        <div className="card-name">{cardName}</div>
        <div className="card-grid">{grid}</div>
      </div>
    )
  }

  const renderDemoBoard = (visual: string) => {
    const cells = []
    
    // Define demo board states for different steps
    const demoStates: Record<string, any> = {
      board: {
        pieces: [
          { player: 2, type: 'student', row: 0, col: 0 },
          { player: 2, type: 'student', row: 0, col: 1 },
          { player: 2, type: 'master', row: 0, col: 2 },
          { player: 2, type: 'student', row: 0, col: 3 },
          { player: 2, type: 'student', row: 0, col: 4 },
          { player: 1, type: 'student', row: 4, col: 0 },
          { player: 1, type: 'student', row: 4, col: 1 },
          { player: 1, type: 'master', row: 4, col: 2 },
          { player: 1, type: 'student', row: 4, col: 3 },
          { player: 1, type: 'student', row: 4, col: 4 },
        ],
        highlight: []
      },
      move: {
        pieces: [
          { player: 2, type: 'student', row: 0, col: 1 },
          { player: 2, type: 'master', row: 0, col: 2 },
          { player: 2, type: 'student', row: 0, col: 3 },
          { player: 1, type: 'student', row: 4, col: 0 },
          { player: 1, type: 'student', row: 4, col: 1 },
          { player: 1, type: 'master', row: 4, col: 2 },
          { player: 1, type: 'student', row: 4, col: 3 },
          { player: 1, type: 'student', row: 4, col: 4 },
        ],
        highlight: [{ row: 3, col: 2 }, { row: 2, col: 2 }],
        selected: { row: 4, col: 2 }
      },
      capture: {
        pieces: [
          { player: 2, type: 'student', row: 2, col: 2 },
          { player: 2, type: 'master', row: 0, col: 2 },
          { player: 1, type: 'student', row: 3, col: 2 },
          { player: 1, type: 'master', row: 4, col: 2 },
        ],
        highlight: [{ row: 2, col: 2 }],
        selected: { row: 3, col: 2 }
      },
      winning: {
        pieces: [
          { player: 2, type: 'master', row: 0, col: 2 },
          { player: 1, type: 'master', row: 1, col: 2 },
        ],
        highlight: [{ row: 0, col: 2 }],
        selected: { row: 1, col: 2 }
      }
    }

    const state = demoStates[visual] || demoStates.board

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const piece = state.pieces.find((p: any) => p.row === row && p.col === col)
        const isTemple = (row === 0 && col === 2) || (row === 4 && col === 2)
        const isHighlight = state.highlight?.some((h: any) => h.row === row && h.col === col)
        const isSelected = state.selected && state.selected.row === row && state.selected.col === col
        
        let cellClass = 'cell'
        if (isTemple) cellClass += ' temple'
        if (isHighlight) cellClass += ' valid-move'
        if (isSelected) cellClass += ' selected-piece'

        cells.push(
          <div key={`${row}-${col}`} className={cellClass}>
            {piece && (
              <div className={`piece player${piece.player} ${piece.type}`}>
              </div>
            )}
          </div>
        )
      }
    }

    return <div className="board demo-board">{cells}</div>
  }

  const renderVisual = (visual: string) => {
    switch (visual) {
      case 'intro':
        return (
          <div className="visual-intro">
            <div className="intro-icons">
              <div className="intro-icon-item">
                <div className="big-icon">👑</div>
                <p>Capture the Master</p>
              </div>
              <div className="intro-icon-item">
                <div className="big-icon">⛩</div>
                <p>Or reach the Temple</p>
              </div>
            </div>
          </div>
        )
      case 'board':
      case 'move':
      case 'capture':
      case 'winning':
        return (
          <div className="visual-board">
            {renderDemoBoard(visual)}
          </div>
        )
      case 'cards':
        return (
          <div className="visual-cards">
            <div className="demo-cards-display">
              <div>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '10px', textAlign: 'center' }}>Your Cards</p>
                <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                  {renderCard('TIGER', true)}
                  {renderCard('CRAB', true)}
                </div>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '10px', textAlign: 'center' }}>Side Card</p>
                {renderCard('MONKEY', true)}
              </div>
            </div>
          </div>
        )
      case 'rotation':
        return (
          <div className="visual-rotation">
            <div className="rotation-diagram">
              <div className="rotation-step">
                <div className="rotation-label">Before Move</div>
                <div className="rotation-cards">
                  <div className="card-small">TIGER</div>
                  <div className="card-small highlight">CRAB ✓</div>
                  <div className="card-small side">MONKEY</div>
                </div>
              </div>
              <div className="rotation-arrow">→</div>
              <div className="rotation-step">
                <div className="rotation-label">After Move</div>
                <div className="rotation-cards">
                  <div className="card-small">TIGER</div>
                  <div className="card-small">MONKEY</div>
                  <div className="card-small side">CRAB</div>
                </div>
              </div>
            </div>
          </div>
        )
      case 'tips':
        return (
          <div className="visual-tips">
            <div className="tip-grid">
              <div className="tip-item">
                <div className="tip-icon">🛡️</div>
                <p>Keep students near your master</p>
              </div>
              <div className="tip-item">
                <div className="tip-icon">👀</div>
                <p>Watch opponent's cards</p>
              </div>
              <div className="tip-item">
                <div className="tip-icon">🎯</div>
                <p>Control the center</p>
              </div>
              <div className="tip-item">
                <div className="tip-icon">⚔️</div>
                <p>Plan your attacks</p>
              </div>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="how-to-play-page">
      <div className="nav-bar">
        <h1>ONITAMA</h1>
        <div className="nav-links">
          <Link to="/game">Game</Link>
          <Link to="/how-to-play">How to Play</Link>
          <Link to="/leaderboard">Leaderboard</Link>
          <button onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="container">
        <div className="how-to-play-content">
          <h1>How to Play Onitama</h1>

          <div className="tutorial-container">
            <div className="tutorial-step">
              <div className="step-indicator">
                Step {tutorialStep + 1} of {tutorialSteps.length}
              </div>
              <h2>{tutorialSteps[tutorialStep].title}</h2>
              
              <div className="tutorial-content-layout">
                <div className="step-visual">
                  {renderVisual(tutorialSteps[tutorialStep].visual)}
                </div>
                <div className="step-content">
                  {tutorialSteps[tutorialStep].content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            </div>

            <div className="tutorial-navigation">
              <button 
                className="btn-tutorial" 
                onClick={prevStep}
                disabled={tutorialStep === 0}
              >
                ← Previous
              </button>
              <div className="step-dots">
                {tutorialSteps.map((_, index) => (
                  <span 
                    key={index}
                    className={`dot ${index === tutorialStep ? 'active' : ''}`}
                    onClick={() => setTutorialStep(index)}
                  />
                ))}
              </div>
              <button 
                className="btn-tutorial" 
                onClick={nextStep}
                disabled={tutorialStep === tutorialSteps.length - 1}
              >
                Next →
              </button>
            </div>
          </div>

          <div className="quick-reference">
            <h2>Quick Reference</h2>
            <div className="reference-grid">
              <div className="reference-item">
                <div className="reference-icon">👑</div>
                <div className="reference-text">
                  <strong>Master</strong>
                  <p>Your most important piece. Protect it!</p>
                </div>
              </div>
              <div className="reference-item">
                <div className="reference-icon">🥋</div>
                <div className="reference-text">
                  <strong>Student</strong>
                  <p>Support pieces that can capture and defend.</p>
                </div>
              </div>
              <div className="reference-item">
                <div className="reference-icon">⛩</div>
                <div className="reference-text">
                  <strong>Temple</strong>
                  <p>Center square on each back row. Move your Master here to win!</p>
                </div>
              </div>
              <div className="reference-item">
                <div className="reference-icon">◉</div>
                <div className="reference-text">
                  <strong>Valid Move</strong>
                  <p>Highlighted squares show where you can move.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="ready-to-play">
            <h2>Ready to Play?</h2>
            <p>Start with Easy difficulty to learn the game, then challenge yourself with Medium and Hard!</p>
            <Link to="/game" className="btn btn-large">
              Start Playing
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HowToPlay
