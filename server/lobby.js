// Redis-backed Lobby and Matchmaking System
// All state stored in Redis so matchmaking works across multiple pods.

import redis from './cache.js';

const QUEUE_KEY = 'lobby:queue';             // Redis List: waiting players
const GAMES_KEY = 'lobby:games';             // Redis Hash: gameId -> JSON game info
const SOCKET_USER_KEY = 'lobby:socket2user'; // Redis Hash: socketId -> username

/**
 * Add a player to the matchmaking queue.
 * Uses a Lua script to atomically check-and-pop or push.
 * @returns {Object|null} Match info if matched, null if waiting
 */
async function joinQueue(socketId, username) {
  await redis.hset(SOCKET_USER_KEY, socketId, username);

  // Atomically: if queue has someone, pop them (match). Otherwise push us.
  const luaScript = `
    local queueLen = redis.call('LLEN', KEYS[1])
    if queueLen > 0 then
      return redis.call('RPOP', KEYS[1])
    else
      redis.call('LPUSH', KEYS[1], ARGV[1])
      return nil
    end
  `;

  const entry = JSON.stringify({ socketId, username, timestamp: Date.now() });
  const result = await redis.eval(luaScript, 1, QUEUE_KEY, entry);

  if (result) {
    const opponent = JSON.parse(result);
    const isPlayer1 = Math.random() < 0.5;

    return {
      player1SocketId: isPlayer1 ? socketId : opponent.socketId,
      player2SocketId: isPlayer1 ? opponent.socketId : socketId,
      player1Username: isPlayer1 ? username : opponent.username,
      player2Username: isPlayer1 ? opponent.username : username,
    };
  }

  return null;
}

/**
 * Remove a player from the queue.
 * @returns {boolean} True if removed
 */
async function leaveQueue(socketId) {
  const entries = await redis.lrange(QUEUE_KEY, 0, -1);
  let removed = false;

  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry);
      if (parsed.socketId === socketId) {
        await redis.lrem(QUEUE_KEY, 1, entry);
        removed = true;
      }
    } catch {
      // skip malformed entries
    }
  }

  await redis.hdel(SOCKET_USER_KEY, socketId);
  return removed;
}

/**
 * Register an active game.
 */
async function registerGame(gameId, player1SocketId, player2SocketId, player1Username, player2Username) {
  const gameInfo = JSON.stringify({
    player1SocketId,
    player2SocketId,
    player1Username,
    player2Username,
  });
  await redis.hset(GAMES_KEY, gameId, gameInfo);
}

/**
 * Get game info by game ID.
 * @returns {Object|null}
 */
async function getGame(gameId) {
  const data = await redis.hget(GAMES_KEY, gameId);
  return data ? JSON.parse(data) : null;
}

/**
 * Remove a game from active games.
 */
async function removeGame(gameId) {
  await redis.hdel(GAMES_KEY, gameId);
}

/**
 * Handle player disconnect.
 * @returns {Object|null} Info about affected game or null
 */
async function handleDisconnect(socketId) {
  await leaveQueue(socketId);

  const username = await redis.hget(SOCKET_USER_KEY, socketId);

  // Check if player was in an active game
  const allGames = await redis.hgetall(GAMES_KEY);
  for (const [gameId, data] of Object.entries(allGames)) {
    const game = JSON.parse(data);
    if (game.player1SocketId === socketId || game.player2SocketId === socketId) {
      const opponentSocketId = game.player1SocketId === socketId
        ? game.player2SocketId
        : game.player1SocketId;

      await redis.hdel(GAMES_KEY, gameId);
      await redis.hdel(SOCKET_USER_KEY, socketId);

      return {
        gameId,
        opponentSocketId,
        disconnectedUsername: username,
      };
    }
  }

  await redis.hdel(SOCKET_USER_KEY, socketId);
  return null;
}

// Export with same interface so server/index.js calls stay unchanged
export const lobby = {
  joinQueue,
  leaveQueue,
  registerGame,
  getGame,
  removeGame,
  handleDisconnect,
};
