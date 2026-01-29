import { CARDS } from './game-logic.js';

export class OnitamaAI {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.maxDepth = {
      easy: 2,
      medium: 3,
      hard: 4
    }[difficulty] || 3;
  }
  
  // Evaluate board position
  evaluatePosition(game, player) {
    if (game.winner) {
      return game.winner === player ? 10000 : -10000;
    }
    
    let score = 0;
    const opponent = player === 1 ? 2 : 1;
    
    // Material advantage (100 points per piece, 500 for master)
    const playerPieces = game.pieces[player];
    const opponentPieces = game.pieces[opponent];
    
    playerPieces.forEach(piece => {
      score += piece.type === 'master' ? 500 : 100;
    });
    
    opponentPieces.forEach(piece => {
      score -= piece.type === 'master' ? 500 : 100;
    });
    
    // Master safety evaluation
    const playerMaster = playerPieces.find(p => p.type === 'master');
    const opponentMaster = opponentPieces.find(p => p.type === 'master');
    
    if (playerMaster) {
      // Check if master can be captured next turn - HEAVILY penalize
      let masterUnderThreat = false;
      const opponentCards = opponent === 1 ? game.player1Cards : game.player2Cards;
      
      opponentCards.forEach(cardName => {
        opponentPieces.forEach((_, pieceIndex) => {
          const moves = game.getValidMoves(opponent, pieceIndex, cardName);
          if (moves.some(m => m.row === playerMaster.row && m.col === playerMaster.col)) {
            masterUnderThreat = true;
          }
        });
      });
      
      if (masterUnderThreat) {
        score -= 800; // HUGE penalty for exposed master
      }
      
      // Count protective pieces around master (students)
      let protectors = 0;
      const adjacentCells = [
        [playerMaster.row - 1, playerMaster.col],
        [playerMaster.row + 1, playerMaster.col],
        [playerMaster.row, playerMaster.col - 1],
        [playerMaster.row, playerMaster.col + 1]
      ];
      
      adjacentCells.forEach(([r, c]) => {
        if (r >= 0 && r <= 4 && c >= 0 && c <= 4) {
          const cell = game.board[r][c];
          if (cell && cell.player === player && cell.type === 'student') {
            protectors++;
          }
        }
      });
      
      score += protectors * 40; // Reward defensive positioning
      
      // Reduced forward progress bonus (less aggressive)
      const progressRow = player === 1 ? (4 - playerMaster.row) : playerMaster.row;
      score += progressRow * 8; // Reduced from 20
      
      // Only bonus for center if well-protected or late game
      if (playerMaster.col === 2 && (protectors >= 2 || opponentPieces.length <= 3)) {
        score += 20;
      }
    }
    
    if (opponentMaster) {
      // Heavily reward threatening opponent's master
      const playerCards = player === 1 ? game.player1Cards : game.player2Cards;
      let canCaptureOpponentMaster = false;
      
      playerCards.forEach(cardName => {
        playerPieces.forEach((_, pieceIndex) => {
          const moves = game.getValidMoves(player, pieceIndex, cardName);
          if (moves.some(m => m.row === opponentMaster.row && m.col === opponentMaster.col)) {
            canCaptureOpponentMaster = true;
          }
        });
      });
      
      if (canCaptureOpponentMaster) {
        score += 700; // Huge bonus for capture opportunity
      }
      
      const progressRow = opponent === 1 ? (4 - opponentMaster.row) : opponentMaster.row;
      score -= progressRow * 8;
      
      if (opponentMaster.col === 2) {
        score -= 20;
      }
    }
    
    // Center control bonus for students
    playerPieces.forEach(piece => {
      if (piece.type === 'student') {
        const centerDistance = Math.abs(piece.row - 2) + Math.abs(piece.col - 2);
        score += (4 - centerDistance) * 5;
      }
    });
    
    opponentPieces.forEach(piece => {
      if (piece.type === 'student') {
        const centerDistance = Math.abs(piece.row - 2) + Math.abs(piece.col - 2);
        score -= (4 - centerDistance) * 5;
      }
    });
    
    // Card strength evaluation
    const playerCards = player === 1 ? game.player1Cards : game.player2Cards;
    const opponentCards = opponent === 1 ? game.player1Cards : game.player2Cards;
    
    score += this.evaluateCards(playerCards) - this.evaluateCards(opponentCards);
    
    return score;
  }
  
  evaluateCards(cards) {
    let value = 0;
    cards.forEach(cardName => {
      const card = CARDS[cardName];
      // Cards with more moves or forward moves are more valuable
      value += card.moves.length * 5;
      
      // Forward-moving cards are more valuable
      const forwardMoves = card.moves.filter(([r, c]) => r > 0).length;
      value += forwardMoves * 3;
    });
    return value;
  }
  
  // Minimax with alpha-beta pruning
  minimax(game, depth, alpha, beta, maximizingPlayer, player) {
    if (depth === 0 || game.winner) {
      return this.evaluatePosition(game, player);
    }
    
    const currentPlayer = maximizingPlayer ? player : (player === 1 ? 2 : 1);
    const moves = game.getAllValidMoves(currentPlayer);
    
    if (moves.length === 0) {
      // No valid moves - pass turn
      return this.evaluatePosition(game, player);
    }
    
    if (maximizingPlayer) {
      let maxEval = -Infinity;
      
      for (const move of moves) {
        // Clone game state and make move
        const testGame = this.cloneGame(game);
        testGame.makeMove(
          currentPlayer,
          move.pieceIndex,
          move.to.row,
          move.to.col,
          move.cardName
        );
        
        const eval_score = this.minimax(testGame, depth - 1, alpha, beta, false, player);
        maxEval = Math.max(maxEval, eval_score);
        alpha = Math.max(alpha, eval_score);
        
        if (beta <= alpha) break; // Beta cutoff
      }
      
      return maxEval;
    } else {
      let minEval = Infinity;
      
      for (const move of moves) {
        const testGame = this.cloneGame(game);
        testGame.makeMove(
          currentPlayer,
          move.pieceIndex,
          move.to.row,
          move.to.col,
          move.cardName
        );
        
        const eval_score = this.minimax(testGame, depth - 1, alpha, beta, true, player);
        minEval = Math.min(minEval, eval_score);
        beta = Math.min(beta, eval_score);
        
        if (beta <= alpha) break; // Alpha cutoff
      }
      
      return minEval;
    }
  }
  
  // Deep clone game state
  cloneGame(game) {
    const cloned = Object.create(Object.getPrototypeOf(game));
    
    cloned.id = game.id;
    cloned.player1 = game.player1;
    cloned.player2 = game.player2;
    cloned.currentPlayer = game.currentPlayer;
    cloned.winner = game.winner;
    cloned.winCondition = game.winCondition;
    cloned.createdAt = game.createdAt;
    
    // Deep clone pieces
    cloned.pieces = {
      1: game.pieces[1].map(p => ({ ...p })),
      2: game.pieces[2].map(p => ({ ...p }))
    };
    
    // Deep clone board
    cloned.board = game.board.map(row => row.map(cell => cell ? { ...cell } : null));
    
    // Clone cards
    cloned.player1Cards = [...game.player1Cards];
    cloned.player2Cards = [...game.player2Cards];
    cloned.sideCard = game.sideCard;
    cloned.moveHistory = [...game.moveHistory];
    
    // Bind methods
    cloned.updateBoard = game.updateBoard.bind(cloned);
    cloned.getValidMoves = game.getValidMoves.bind(cloned);
    cloned.makeMove = game.makeMove.bind(cloned);
    cloned.getState = game.getState.bind(cloned);
    cloned.getAllValidMoves = game.getAllValidMoves.bind(cloned);
    
    return cloned;
  }
  
  // Get best move for AI player
  getBestMove(game, player) {
    const moves = game.getAllValidMoves(player);
    
    if (moves.length === 0) return null;
    
    let bestMove = null;
    let bestValue = -Infinity;
    
    for (const move of moves) {
      const testGame = this.cloneGame(game);
      testGame.makeMove(
        player,
        move.pieceIndex,
        move.to.row,
        move.to.col,
        move.cardName
      );
      
      const moveValue = this.minimax(
        testGame,
        this.maxDepth - 1,
        -Infinity,
        Infinity,
        false,
        player
      );
      
      if (moveValue > bestValue) {
        bestValue = moveValue;
        bestMove = move;
      }
    }
    
    return bestMove;
  }
}
