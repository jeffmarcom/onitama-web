// Onitama Game Engine
// Implements core game logic for the ancient game of Onitama

const CARD_MOVES = {
  TIGER: [[2, 0], [-1, 0]],
  DRAGON: [[-1, -2], [-1, 2], [1, -1], [1, 1]],
  CRAB: [[1, 0], [0, -2], [0, 2]],
  ELEPHANT: [[1, -1], [1, 1], [0, -1], [0, 1]],
  MONKEY: [[1, -1], [1, 1], [-1, -1], [-1, 1]],
  MANTIS: [[1, -1], [1, 1], [-1, 0]],
  CRANE: [[1, 0], [-1, -1], [-1, 1]],
  BOAR: [[1, 0], [0, -1], [0, 1]],
  FROG: [[1, -1], [0, -2], [-1, 1]],
  RABBIT: [[1, 1], [0, 2], [-1, -1]],
  GOOSE: [[1, -1], [0, -1], [0, 1], [-1, 1]],
  ROOSTER: [[1, 1], [0, 1], [0, -1], [-1, -1]],
  HORSE: [[1, 0], [0, -1], [-1, 0]],
  OX: [[1, 0], [0, 1], [-1, 0]],
  EEL: [[1, -1], [0, 1], [-1, -1]],
  COBRA: [[1, 1], [0, -1], [-1, 1]]
};

const ALL_CARDS = Object.keys(CARD_MOVES);

/**
 * Initialize a new game with starting positions and random cards
 * @returns {Object} Initial game state
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initializeGame() {
  // Shuffle and deal 5 cards (2 per player + 1 side card)
  const shuffled = shuffle(ALL_CARDS);
  const player1Cards = shuffled.slice(0, 2);
  const player2Cards = shuffled.slice(2, 4);
  const sideCard = shuffled[4];

  // Initialize pieces
  // Player 1 (human) at bottom (row 4)
  const player1Pieces = [
    { row: 4, col: 0, player: 1, type: 'student' },
    { row: 4, col: 1, player: 1, type: 'student' },
    { row: 4, col: 2, player: 1, type: 'master' },
    { row: 4, col: 3, player: 1, type: 'student' },
    { row: 4, col: 4, player: 1, type: 'student' }
  ];

  // Player 2 (AI) at top (row 0)
  const player2Pieces = [
    { row: 0, col: 0, player: 2, type: 'student' },
    { row: 0, col: 1, player: 2, type: 'student' },
    { row: 0, col: 2, player: 2, type: 'master' },
    { row: 0, col: 3, player: 2, type: 'student' },
    { row: 0, col: 4, player: 2, type: 'student' }
  ];

  // Initialize 5x5 board
  const board = Array(5).fill(null).map(() => Array(5).fill(null));
  
  // Place pieces on board
  player1Pieces.forEach(piece => {
    board[piece.row][piece.col] = piece;
  });
  player2Pieces.forEach(piece => {
    board[piece.row][piece.col] = piece;
  });

  return {
    pieces: { 1: player1Pieces, 2: player2Pieces },
    board,
    player1Cards,
    player2Cards,
    sideCard,
    currentPlayer: 1, // Player 1 (human) starts
    winner: null,
    winCondition: null
  };
}

/**
 * Check if a move is valid
 * @param {Object} gameState - Current game state
 * @param {number} player - Player number (1 or 2)
 * @param {number} pieceIndex - Index of piece in player's pieces array
 * @param {number} toRow - Destination row
 * @param {number} toCol - Destination column
 * @param {string} cardName - Card being used for the move
 * @returns {boolean} Whether the move is valid
 */
export function isValidMove(gameState, player, pieceIndex, toRow, toCol, cardName) {
  // Check if it's the player's turn
  if (gameState.currentPlayer !== player) {
    return false;
  }

  // Check if game is over
  if (gameState.winner) {
    return false;
  }

  // Check if player has the card
  const playerCards = player === 1 ? gameState.player1Cards : gameState.player2Cards;
  if (!playerCards.includes(cardName)) {
    return false;
  }

  // Get the piece
  const piece = gameState.pieces[player][pieceIndex];
  if (!piece) {
    return false;
  }

  // Check bounds
  if (toRow < 0 || toRow > 4 || toCol < 0 || toCol > 4) {
    return false;
  }

  // Check if destination has own piece
  const destPiece = gameState.board[toRow][toCol];
  if (destPiece && destPiece.player === player) {
    return false;
  }

  // Get card moves and check if this move matches one
  const moves = CARD_MOVES[cardName] || [];
  const fromRow = piece.row;
  const fromCol = piece.col;

  for (const [dRow, dCol] of moves) {
    let newRow, newCol;
    
    // Player 1 moves "up" the board (decreasing row numbers)
    // Player 2 moves "down" the board (increasing row numbers)
    // Card moves are defined from player's perspective:
    // - positive dRow = forward toward opponent
    // - negative dRow = backward
    // - positive dCol = right, negative dCol = left
    
    if (player === 1) {
      // For player 1: forward (positive dRow) means decreasing row
      newRow = fromRow - dRow;
      newCol = fromCol + dCol;
    } else {
      // For player 2: forward (positive dRow) means increasing row
      // Also flip horizontal moves (mirror the card)
      newRow = fromRow + dRow;
      newCol = fromCol - dCol;
    }

    if (newRow === toRow && newCol === toCol) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a move and update game state
 * @param {Object} gameState - Current game state
 * @param {number} player - Player number (1 or 2)
 * @param {number} pieceIndex - Index of piece in player's pieces array
 * @param {number} toRow - Destination row
 * @param {number} toCol - Destination column
 * @param {string} cardName - Card being used for the move
 * @returns {Object} Updated game state
 */
export function makeMove(gameState, player, pieceIndex, toRow, toCol, cardName) {
  // Create a deep copy of the game state
  const newState = JSON.parse(JSON.stringify(gameState));
  
  const piece = newState.pieces[player][pieceIndex];
  const fromRow = piece.row;
  const fromCol = piece.col;
  
  // Check if destination has opponent piece (capture)
  const destPiece = newState.board[toRow][toCol];
  if (destPiece && destPiece.player !== player) {
    // Remove captured piece from opponent's pieces array
    const opponentPlayer = player === 1 ? 2 : 1;
    newState.pieces[opponentPlayer] = newState.pieces[opponentPlayer].filter(
      p => !(p.row === toRow && p.col === toCol)
    );
  }
  
  // Move piece
  newState.board[fromRow][fromCol] = null;
  piece.row = toRow;
  piece.col = toCol;
  newState.board[toRow][toCol] = piece;
  
  // Swap card with side card
  const playerCards = player === 1 ? newState.player1Cards : newState.player2Cards;
  const cardIndex = playerCards.indexOf(cardName);
  playerCards[cardIndex] = newState.sideCard;
  newState.sideCard = cardName;
  
  // Check win condition
  const winResult = checkWinCondition(newState, player, piece, toRow, toCol, destPiece);
  if (winResult) {
    newState.winner = winResult.winner;
    newState.winCondition = winResult.condition;
  }
  
  // Switch turns
  newState.currentPlayer = player === 1 ? 2 : 1;
  
  return newState;
}

/**
 * Check if the game has been won
 * @param {Object} gameState - Current game state
 * @param {number} player - Player who just moved
 * @param {Object} piece - Piece that was moved
 * @param {number} toRow - Destination row
 * @param {number} toCol - Destination column
 * @param {Object} capturedPiece - Piece that was captured (if any)
 * @returns {Object|null} Win result or null
 */
export function checkWinCondition(gameState, player, piece, toRow, toCol, capturedPiece) {
  // Way of the Stone: Capture opponent's master
  if (capturedPiece && capturedPiece.type === 'master') {
    return {
      winner: player,
      condition: 'Way of the Stone (Master Captured)'
    };
  }
  
  // Way of the Stream: Move master to opponent's temple
  if (piece.type === 'master') {
    // Player 1's master reaching row 0, col 2 (opponent's temple)
    if (player === 1 && toRow === 0 && toCol === 2) {
      return {
        winner: player,
        condition: 'Way of the Stream (Temple Reached)'
      };
    }
    // Player 2's master reaching row 4, col 2 (opponent's temple)
    if (player === 2 && toRow === 4 && toCol === 2) {
      return {
        winner: player,
        condition: 'Way of the Stream (Temple Reached)'
      };
    }
  }
  
  return null;
}

/**
 * Get all valid moves for a player
 * @param {Object} gameState - Current game state
 * @param {number} player - Player number
 * @returns {Array} Array of valid moves
 */
export function getAllValidMoves(gameState, player) {
  const moves = [];
  const pieces = gameState.pieces[player];
  const playerCards = player === 1 ? gameState.player1Cards : gameState.player2Cards;
  
  pieces.forEach((piece, pieceIndex) => {
    playerCards.forEach(cardName => {
      const cardMoves = CARD_MOVES[cardName] || [];
      
      cardMoves.forEach(([dRow, dCol]) => {
        let newRow, newCol;
        
        if (player === 1) {
          newRow = piece.row - dRow;
          newCol = piece.col + dCol;
        } else {
          newRow = piece.row + dRow;
          newCol = piece.col - dCol;
        }
        
        // Check if move is valid
        if (isValidMove(gameState, player, pieceIndex, newRow, newCol, cardName)) {
          moves.push({
            pieceIndex,
            fromRow: piece.row,
            fromCol: piece.col,
            toRow: newRow,
            toCol: newCol,
            cardName,
            piece
          });
        }
      });
    });
  });
  
  return moves;
}

/**
 * Score a move for AI decision making
 * @param {Object} gameState - Game state after the move
 * @param {Object} move - The move to score
 * @param {number} player - Player making the move
 * @param {Object|null} capturedPiece - Piece at destination before the move (for capture bonus)
 * @returns {number} Score for the move
 */
function scoreMove(gameState, move, player, capturedPiece = null) {
  let score = 0;
  
  // Check if move wins the game
  if (gameState.winner === player) {
    return 10000;
  }
  
  // Check if move captures a piece (use piece at destination BEFORE move, not after)
  if (capturedPiece && capturedPiece.player !== player) {
    score += capturedPiece.type === 'master' ? 10000 : 50;
  }
  
  // Favor advancing the master toward opponent's temple
  if (move.piece.type === 'master') {
    if (player === 2) {
      // Player 2 wants to move master to row 4
      score += (4 - move.toRow) * 10;
    } else {
      // Player 1 wants to move master to row 0
      score += move.fromRow * 10;
    }
    
    // Extra bonus for being on temple column
    if (move.toCol === 2) {
      score += 20;
    }
  }
  
  // Favor center control
  const distFromCenter = Math.abs(move.toCol - 2);
  score += (2 - distFromCenter) * 2;
  
  // Slight bonus for forward movement
  if (player === 2 && move.toRow > move.fromRow) {
    score += 5;
  } else if (player === 1 && move.toRow < move.fromRow) {
    score += 5;
  }
  
  return score;
}

/**
 * Get AI move based on difficulty
 * @param {Object} gameState - Current game state
 * @param {string} difficulty - Difficulty level (easy/medium/hard)
 * @returns {Object|null} Selected move or null if no moves available
 */
export function getAIMove(gameState, difficulty = 'medium') {
  const player = 2; // AI is always player 2
  const validMoves = getAllValidMoves(gameState, player);
  
  if (validMoves.length === 0) {
    return null;
  }
  
  if (difficulty === 'easy') {
    // Random move
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  }
  
  if (difficulty === 'medium') {
    // Score each move and pick the best
    let bestMove = validMoves[0];
    let bestScore = -Infinity;
    
    for (const move of validMoves) {
      // Capture bonus: read destination piece before applying move
      const capturedPiece = gameState.board[move.toRow][move.toCol];
      const newState = makeMove(gameState, player, move.pieceIndex, move.toRow, move.toCol, move.cardName);
      const score = scoreMove(newState, move, player, capturedPiece);
      
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    
    return bestMove;
  }
  
  if (difficulty === 'hard') {
    // Minimax with limited depth
    return minimaxMove(gameState, player, 2);
  }
  
  // Default to medium
  return getAIMove(gameState, 'medium');
}

/**
 * Minimax algorithm for hard difficulty
 * @param {Object} gameState - Current game state
 * @param {number} player - AI player number
 * @param {number} depth - Search depth
 * @returns {Object|null} Best move
 */
function minimaxMove(gameState, player, depth) {
  const validMoves = getAllValidMoves(gameState, player);
  
  if (validMoves.length === 0) {
    return null;
  }
  
  let bestMove = validMoves[0];
  let bestScore = -Infinity;
  
  for (const move of validMoves) {
    const newState = makeMove(gameState, player, move.pieceIndex, move.toRow, move.toCol, move.cardName);
    const score = minimax(newState, depth - 1, false, player, -Infinity, Infinity);
    
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  
  return bestMove;
}

/**
 * Minimax helper with alpha-beta pruning
 */
function minimax(gameState, depth, isMaximizing, aiPlayer, alpha, beta) {
  // Base case: game over or depth limit reached
  if (gameState.winner || depth === 0) {
    if (gameState.winner === aiPlayer) {
      return 10000 + depth; // Prefer faster wins
    } else if (gameState.winner) {
      return -10000 - depth; // Avoid faster losses
    }
    // Evaluate position
    return evaluatePosition(gameState, aiPlayer);
  }
  
  const currentPlayer = gameState.currentPlayer;
  const validMoves = getAllValidMoves(gameState, currentPlayer);
  
  if (validMoves.length === 0) {
    // No valid moves (shouldn't happen in Onitama, but handle it)
    return 0;
  }
  
  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of validMoves) {
      const newState = makeMove(gameState, currentPlayer, move.pieceIndex, move.toRow, move.toCol, move.cardName);
      const score = minimax(newState, depth - 1, false, aiPlayer, alpha, beta);
      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break; // Prune
    }
    return maxScore;
  } else {
    let minScore = Infinity;
    for (const move of validMoves) {
      const newState = makeMove(gameState, currentPlayer, move.pieceIndex, move.toRow, move.toCol, move.cardName);
      const score = minimax(newState, depth - 1, true, aiPlayer, alpha, beta);
      minScore = Math.min(minScore, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break; // Prune
    }
    return minScore;
  }
}

/**
 * Evaluate board position for minimax
 */
function evaluatePosition(gameState, aiPlayer) {
  let score = 0;
  const humanPlayer = aiPlayer === 1 ? 2 : 1;
  
  // Material advantage
  const aiPieces = gameState.pieces[aiPlayer].length;
  const humanPieces = gameState.pieces[humanPlayer].length;
  score += (aiPieces - humanPieces) * 50;
  
  // Master position (distance to opponent temple)
  const aiMaster = gameState.pieces[aiPlayer].find(p => p.type === 'master');
  const humanMaster = gameState.pieces[humanPlayer].find(p => p.type === 'master');
  
  if (aiMaster) {
    const aiDistToTemple = aiPlayer === 2 ? (4 - aiMaster.row) : aiMaster.row;
    score -= aiDistToTemple * 10;
    if (aiMaster.col === 2) score += 15;
  }
  
  if (humanMaster) {
    const humanDistToTemple = humanPlayer === 2 ? (4 - humanMaster.row) : humanMaster.row;
    score += humanDistToTemple * 10;
  }
  
  return score;
}
