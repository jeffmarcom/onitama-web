// Movement card definitions - all 16 cards from base game
// Moves are relative to current position: [row_delta, col_delta]
// Positive row = moving toward opponent (up the board)
export const CARDS = {
  TIGER: {
    name: 'Tiger',
    color: 'blue',
    moves: [[2, 0], [-1, 0]]
  },
  DRAGON: {
    name: 'Dragon',
    color: 'red',
    moves: [[-1, -2], [-1, 2], [1, -1], [1, 1]]
  },
  CRAB: {
    name: 'Crab',
    color: 'blue',
    moves: [[1, 0], [0, -2], [0, 2]]
  },
  ELEPHANT: {
    name: 'Elephant',
    color: 'red',
    moves: [[1, -1], [1, 1], [0, -1], [0, 1]]
  },
  MONKEY: {
    name: 'Monkey',
    color: 'blue',
    moves: [[1, -1], [1, 1], [-1, -1], [-1, 1]]
  },
  MANTIS: {
    name: 'Mantis',
    color: 'red',
    moves: [[1, -1], [1, 1], [-1, 0]]
  },
  CRANE: {
    name: 'Crane',
    color: 'blue',
    moves: [[1, 0], [-1, -1], [-1, 1]]
  },
  BOAR: {
    name: 'Boar',
    color: 'red',
    moves: [[1, 0], [0, -1], [0, 1]]
  },
  FROG: {
    name: 'Frog',
    color: 'red',
    moves: [[1, -1], [0, -2], [-1, 1]]
  },
  RABBIT: {
    name: 'Rabbit',
    color: 'blue',
    moves: [[1, 1], [0, 2], [-1, -1]]
  },
  GOOSE: {
    name: 'Goose',
    color: 'blue',
    moves: [[1, -1], [0, -1], [0, 1], [-1, 1]]
  },
  ROOSTER: {
    name: 'Rooster',
    color: 'red',
    moves: [[1, 1], [0, 1], [0, -1], [-1, -1]]
  },
  HORSE: {
    name: 'Horse',
    color: 'red',
    moves: [[1, 0], [0, -1], [-1, 0]]
  },
  OX: {
    name: 'Ox',
    color: 'blue',
    moves: [[1, 0], [0, 1], [-1, 0]]
  },
  EEL: {
    name: 'Eel',
    color: 'blue',
    moves: [[1, -1], [0, 1], [-1, -1]]
  },
  COBRA: {
    name: 'Cobra',
    color: 'red',
    moves: [[1, 1], [0, -1], [-1, 1]]
  }
};

export class OnitamaGame {
  constructor(player1Id, player2Id = 'AI') {
    this.id = crypto.randomUUID();
    this.player1 = player1Id;
    this.player2 = player2Id;
    this.currentPlayer = 1;
    this.winner = null;
    this.winCondition = null;
    
    // Initialize 5x5 board
    // null = empty, { player: 1|2, type: 'master'|'student', position: [row, col] }
    this.board = Array(5).fill(null).map(() => Array(5).fill(null));
    
    // Place pieces - Player 1 on bottom (row 4), Player 2 on top (row 0)
    this.pieces = {
      1: [
        { type: 'student', row: 4, col: 0 },
        { type: 'student', row: 4, col: 1 },
        { type: 'master', row: 4, col: 2 },
        { type: 'student', row: 4, col: 3 },
        { type: 'student', row: 4, col: 4 }
      ],
      2: [
        { type: 'student', row: 0, col: 0 },
        { type: 'student', row: 0, col: 1 },
        { type: 'master', row: 0, col: 2 },
        { type: 'student', row: 0, col: 3 },
        { type: 'student', row: 0, col: 4 }
      ]
    };
    
    // Update board with pieces
    this.updateBoard();
    
    // Deal random cards
    const allCards = Object.keys(CARDS);
    const shuffled = allCards.sort(() => Math.random() - 0.5);
    
    this.player1Cards = [shuffled[0], shuffled[1]];
    this.player2Cards = [shuffled[2], shuffled[3]];
    this.sideCard = shuffled[4];
    
    // Determine starting player based on side card color
    const sideCardColor = CARDS[this.sideCard].color;
    this.currentPlayer = sideCardColor === 'red' ? 1 : 2;
    
    this.moveHistory = [];
    this.createdAt = new Date().toISOString();
  }
  
  updateBoard() {
    // Clear board
    this.board = Array(5).fill(null).map(() => Array(5).fill(null));
    
    // Place all pieces
    [1, 2].forEach(player => {
      this.pieces[player].forEach(piece => {
        this.board[piece.row][piece.col] = {
          player,
          type: piece.type
        };
      });
    });
  }
  
  getValidMoves(player, pieceIndex, cardName) {
    const piece = this.pieces[player][pieceIndex];
    if (!piece) return [];
    
    const card = CARDS[cardName];
    if (!card) return [];
    
    const validMoves = [];
    const { row, col } = piece;
    
    card.moves.forEach(([dRow, dCol]) => {
      // Cards defined with positive row = toward opponent
      // Player 1 at row 4 moving to row 0 = need to negate row
      // Player 2 at row 0 moving to row 4 = use row as-is
      // Column: positive = right for both (no flip needed)
      const finalDRow = player === 1 ? -dRow : dRow;
      const finalDCol = dCol;  // No flip for columns
      
      const newRow = row + finalDRow;
      const newCol = col + finalDCol;
      
      // Check bounds
      if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) return;
      
      // Check if destination has own piece
      const destPiece = this.board[newRow][newCol];
      if (destPiece && destPiece.player === player) return;
      
      validMoves.push({ row: newRow, col: newCol });
    });
    
    return validMoves;
  }
  
  makeMove(player, pieceIndex, toRow, toCol, cardName) {
    if (this.winner) {
      return { success: false, error: 'Game already ended' };
    }
    
    if (this.currentPlayer !== player) {
      return { success: false, error: 'Not your turn' };
    }
    
    // Verify player has this card
    const playerCards = player === 1 ? this.player1Cards : this.player2Cards;
    if (!playerCards.includes(cardName)) {
      return { success: false, error: 'You do not have this card' };
    }
    
    // Get valid moves for this piece with this card
    const validMoves = this.getValidMoves(player, pieceIndex, cardName);
    const moveValid = validMoves.some(m => m.row === toRow && m.col === toCol);
    
    if (!moveValid) {
      return { success: false, error: 'Invalid move for this card' };
    }
    
    const piece = this.pieces[player][pieceIndex];
    const fromRow = piece.row;
    const fromCol = piece.col;
    
    // Check for capture
    const targetPiece = this.board[toRow][toCol];
    let capturedPiece = null;
    
    if (targetPiece) {
      // Remove captured piece
      const opponentPieces = this.pieces[targetPiece.player];
      const capturedIndex = opponentPieces.findIndex(
        p => p.row === toRow && p.col === toCol
      );
      if (capturedIndex >= 0) {
        capturedPiece = opponentPieces.splice(capturedIndex, 1)[0];
      }
      
      // Check for master capture (Way of the Stone)
      if (capturedPiece && capturedPiece.type === 'master') {
        this.winner = player;
        this.winCondition = 'Way of the Stone';
      }
    }
    
    // Move piece
    piece.row = toRow;
    piece.col = toCol;
    this.updateBoard();
    
    // Check for Way of the Stream (master reached opponent temple)
    if (piece.type === 'master') {
      const templeRow = player === 1 ? 0 : 4;
      if (toRow === templeRow && toCol === 2) {
        this.winner = player;
        this.winCondition = 'Way of the Stream';
      }
    }
    
    // Record move
    this.moveHistory.push({
      player,
      pieceIndex,
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      card: cardName,
      captured: capturedPiece,
      timestamp: new Date().toISOString()
    });
    
    // Exchange cards
    if (player === 1) {
      const cardIndex = this.player1Cards.indexOf(cardName);
      this.player1Cards[cardIndex] = this.sideCard;
      this.sideCard = cardName;
    } else {
      const cardIndex = this.player2Cards.indexOf(cardName);
      this.player2Cards[cardIndex] = this.sideCard;
      this.sideCard = cardName;
    }
    
    // Switch turn
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    
    return { success: true, gameState: this.getState() };
  }
  
  getState() {
    return {
      id: this.id,
      player1: this.player1,
      player2: this.player2,
      currentPlayer: this.currentPlayer,
      board: this.board,
      pieces: this.pieces,
      player1Cards: this.player1Cards,
      player2Cards: this.player2Cards,
      sideCard: this.sideCard,
      winner: this.winner,
      winCondition: this.winCondition,
      moveHistory: this.moveHistory,
      createdAt: this.createdAt
    };
  }
  
  getAllValidMoves(player) {
    const moves = [];
    const playerCards = player === 1 ? this.player1Cards : this.player2Cards;
    
    this.pieces[player].forEach((piece, pieceIndex) => {
      playerCards.forEach(cardName => {
        const validMoves = this.getValidMoves(player, pieceIndex, cardName);
        validMoves.forEach(move => {
          moves.push({
            pieceIndex,
            cardName,
            to: move
          });
        });
      });
    });
    
    return moves;
  }
}
