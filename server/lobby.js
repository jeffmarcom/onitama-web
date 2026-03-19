// Redis-backed Lobby and Matchmaking System
// All state stored in Redis so matchmaking works across multiple pods.
// Game session keys use TTL so abandoned sessions are evicted (saves memory).

import redis from './cache.js';

const QUEUE_KEY = 'lobby:queue';             // Redis List: waiting players
const SOCKET_USER_KEY = 'lobby:socket2user'; // Redis Hash: socketId -> username
const GAME_KEY_PREFIX = 'lobby:game:';       // gameId -> JSON game info (per-key TTL)
const SOCKET_TO_GAME_PREFIX = 'lobby:socket:'; // socketId -> gameId (for disconnect lookup)
const GAME_SESSION_TTL_SEC = 6 * 3600;      // 6 hours: clean up abandoned game session state

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
 * Register an active game. Keys have TTL so abandoned sessions are evicted.
 */
async function registerGame(gameId, player1SocketId, player2SocketId, player1Username, player2Username) {
  const gameInfo = JSON.stringify({
    player1SocketId,
    player2SocketId,
    player1Username,
    player2Username,
  });
  const gameKey = GAME_KEY_PREFIX + gameId;
  await redis.set(gameKey, gameInfo, 'EX', GAME_SESSION_TTL_SEC);
  await redis.set(SOCKET_TO_GAME_PREFIX + player1SocketId, gameId, 'EX', GAME_SESSION_TTL_SEC);
  await redis.set(SOCKET_TO_GAME_PREFIX + player2SocketId, gameId, 'EX', GAME_SESSION_TTL_SEC);
}

/**
 * Get game info by game ID.
 * @returns {Object|null}
 */
async function getGame(gameId) {
  const data = await redis.get(GAME_KEY_PREFIX + gameId);
  return data ? JSON.parse(data) : null;
}

/**
 * Remove a game from active games (and socket->gameId index).
 */
async function removeGame(gameId) {
  const game = await getGame(gameId);
  const gameKey = GAME_KEY_PREFIX + gameId;
  await redis.del(gameKey);
  if (game) {
    await redis.del(SOCKET_TO_GAME_PREFIX + game.player1SocketId);
    await redis.del(SOCKET_TO_GAME_PREFIX + game.player2SocketId);
  }
}

/**
 * Handle player disconnect.
 * @returns {Object|null} Info about affected game or null
 */
async function handleDisconnect(socketId) {
  await leaveQueue(socketId);

  const username = await redis.hget(SOCKET_USER_KEY, socketId);
  const gameId = await redis.get(SOCKET_TO_GAME_PREFIX + socketId);

  if (gameId) {
    const game = await getGame(gameId);
    if (game) {
      const opponentSocketId = game.player1SocketId === socketId
        ? game.player2SocketId
        : game.player1SocketId;
      await removeGame(gameId);
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
