// Lobby and Matchmaking System
// Manages player queue and matches players for PvP games

class Lobby {
  constructor() {
    // Queue of players waiting for a match: [{ socketId, username, timestamp }]
    this.waitingQueue = [];
    
    // Active games: Map<gameId, { player1Socket, player2Socket, player1Username, player2Username }>
    this.activeGames = new Map();
    
    // Socket to username mapping: Map<socketId, username>
    this.socketToUsername = new Map();
  }

  /**
   * Add a player to the matchmaking queue
   * @param {string} socketId - Socket ID of the player
   * @param {string} username - Username of the player
   * @returns {Object|null} Match info if matched, null if waiting
   */
  joinQueue(socketId, username) {
    // Check if player is already in queue
    if (this.waitingQueue.some(p => p.socketId === socketId)) {
      return null;
    }

    // Track socket to username mapping
    this.socketToUsername.set(socketId, username);

    // If there's someone waiting, match them
    if (this.waitingQueue.length > 0) {
      const opponent = this.waitingQueue.shift();
      
      // Randomly assign player numbers
      const isPlayer1 = Math.random() < 0.5;
      
      const match = {
        player1SocketId: isPlayer1 ? socketId : opponent.socketId,
        player2SocketId: isPlayer1 ? opponent.socketId : socketId,
        player1Username: isPlayer1 ? username : opponent.username,
        player2Username: isPlayer1 ? opponent.username : username
      };
      
      return match;
    }

    // No one waiting, add to queue
    this.waitingQueue.push({
      socketId,
      username,
      timestamp: Date.now()
    });

    return null;
  }

  /**
   * Remove a player from the queue
   * @param {string} socketId - Socket ID of the player
   * @returns {boolean} True if removed, false if not in queue
   */
  leaveQueue(socketId) {
    const index = this.waitingQueue.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      this.waitingQueue.splice(index, 1);
      this.socketToUsername.delete(socketId);
      return true;
    }
    return false;
  }

  /**
   * Register an active game
   * @param {string} gameId - Game ID
   * @param {string} player1SocketId - Player 1's socket ID
   * @param {string} player2SocketId - Player 2's socket ID
   * @param {string} player1Username - Player 1's username
   * @param {string} player2Username - Player 2's username
   */
  registerGame(gameId, player1SocketId, player2SocketId, player1Username, player2Username) {
    this.activeGames.set(gameId, {
      player1SocketId,
      player2SocketId,
      player1Username,
      player2Username
    });
  }

  /**
   * Get game info by game ID
   * @param {string} gameId - Game ID
   * @returns {Object|null} Game info or null
   */
  getGame(gameId) {
    return this.activeGames.get(gameId) || null;
  }

  /**
   * Get game ID by socket ID
   * @param {string} socketId - Socket ID
   * @returns {string|null} Game ID or null
   */
  getGameBySocket(socketId) {
    for (const [gameId, game] of this.activeGames.entries()) {
      if (game.player1SocketId === socketId || game.player2SocketId === socketId) {
        return gameId;
      }
    }
    return null;
  }

  /**
   * Get opponent socket ID
   * @param {string} gameId - Game ID
   * @param {string} socketId - Current player's socket ID
   * @returns {string|null} Opponent's socket ID or null
   */
  getOpponentSocket(gameId, socketId) {
    const game = this.activeGames.get(gameId);
    if (!game) return null;
    
    if (game.player1SocketId === socketId) {
      return game.player2SocketId;
    } else if (game.player2SocketId === socketId) {
      return game.player1SocketId;
    }
    return null;
  }

  /**
   * Remove a game from active games
   * @param {string} gameId - Game ID
   */
  removeGame(gameId) {
    this.activeGames.delete(gameId);
  }

  /**
   * Handle player disconnect
   * @param {string} socketId - Socket ID of disconnected player
   * @returns {Object|null} Info about affected game or null
   */
  handleDisconnect(socketId) {
    // Remove from queue if waiting
    this.leaveQueue(socketId);

    // Check if player was in an active game
    const gameId = this.getGameBySocket(socketId);
    if (gameId) {
      const game = this.activeGames.get(gameId);
      const opponentSocketId = this.getOpponentSocket(gameId, socketId);
      this.removeGame(gameId);
      
      return {
        gameId,
        opponentSocketId,
        disconnectedUsername: this.socketToUsername.get(socketId)
      };
    }

    // Clean up socket mapping
    this.socketToUsername.delete(socketId);
    
    return null;
  }

  /**
   * Get queue status
   * @returns {Object} Queue information
   */
  getQueueStatus() {
    return {
      playersWaiting: this.waitingQueue.length,
      activeGames: this.activeGames.size
    };
  }
}

// Export singleton instance
export const lobby = new Lobby();
