/**
 * Onitama Load Generator
 *
 * Simulates concurrent users to exercise the app under load:
 *   - Registers / logs in virtual users (HTTP)
 *   - Starts AI games and makes moves (CPU-intensive game engine + minimax)
 *   - Opens WebSocket connections and joins the lobby for PvP matchmaking
 *   - Ramps up concurrency over a configurable window
 *
 * Configuration via environment variables:
 *   TARGET_URL        - Base URL of the Onitama app (default: http://localhost:3000)
 *   CONCURRENT_USERS  - Total virtual users to spawn (default: 20)
 *   RAMP_UP_SECONDS   - Seconds to reach full concurrency (default: 60)
 *   CYCLE_DELAY_MS    - Delay between game actions per user (default: 2000)
 *   ENABLE_WEBSOCKETS - Whether to open WS connections (default: true)
 */

import { io as ioClient } from 'socket.io-client';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS || '20', 10);
const RAMP_UP_SECONDS = parseInt(process.env.RAMP_UP_SECONDS || '60', 10);
const CYCLE_DELAY_MS = parseInt(process.env.CYCLE_DELAY_MS || '2000', 10);
const ENABLE_WEBSOCKETS = process.env.ENABLE_WEBSOCKETS !== 'false';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Metrics ─────────────────────────────────────────────────────────────────

let stats = { requests: 0, errors: 0, games: 0, moves: 0, wsConnections: 0 };

function logStats() {
  const mem = process.memoryUsage();
  console.log(
    `[stats] requests=${stats.requests} errors=${stats.errors} games=${stats.games} ` +
    `moves=${stats.moves} ws=${stats.wsConnections} rss=${Math.round(mem.rss / 1024 / 1024)}MB`
  );
}

setInterval(logStats, 10000);

// ── HTTP helpers ────────────────────────────────────────────────────────────

const LOAD_TEST_KEY = process.env.LOAD_TEST_KEY || '';

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (LOAD_TEST_KEY) headers['X-Load-Test'] = LOAD_TEST_KEY;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${TARGET_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  stats.requests++;
  if (!res.ok) {
    stats.errors++;
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json();
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${TARGET_URL}${path}`, { headers });
  stats.requests++;
  if (!res.ok) {
    stats.errors++;
    throw new Error(`${res.status} ${path}`);
  }
  return res.json();
}

// ── Virtual user ────────────────────────────────────────────────────────────

async function registerOrLogin(username, password) {
  try {
    const data = await post('/api/auth/register', { username, password });
    return data.token;
  } catch {
    // Already registered — log in instead
    const data = await post('/api/auth/login', { username, password });
    return data.token;
  }
}

/**
 * Play a single AI game: create game, make moves until game ends or max moves.
 * The server-side AI (minimax on hard) is the main CPU consumer.
 */
async function playAIGame(token, difficulty = 'hard') {
  const { gameId, gameState } = await post('/api/game/new', { difficulty }, token);
  stats.games++;

  let state = gameState;
  let moveCount = 0;
  const maxMoves = 40;

  while (!state.winner && moveCount < maxMoves) {
    // Wait for it to be player 1's turn (AI moves asynchronously server-side)
    if (state.currentPlayer !== 1) {
      await sleep(CYCLE_DELAY_MS);
      const refreshed = await get(`/api/game/${gameId}`, token);
      state = refreshed.gameState;
      continue;
    }

    // Pick a valid move by trying each piece + card combination
    const moved = await tryRandomMove(token, gameId, state);
    if (!moved) break;

    state = moved.gameState;
    moveCount++;
    stats.moves++;

    await sleep(CYCLE_DELAY_MS);

    // If AI should move next, poll for the result
    if (!state.winner && state.currentPlayer === 2) {
      await sleep(2000); // Wait for AI processing
      const refreshed = await get(`/api/game/${gameId}`, token);
      state = refreshed.gameState;
    }
  }
}

async function tryRandomMove(token, gameId, state) {
  const cards = state.player1Cards || [];
  const pieces = state.pieces?.['1'] || state.pieces?.[1] || [];

  // Shuffle pieces and cards for variety
  const shuffledPieces = [...pieces.keys()].sort(() => Math.random() - 0.5);
  const shuffledCards = [...cards].sort(() => Math.random() - 0.5);

  for (const pieceIndex of shuffledPieces) {
    const piece = pieces[pieceIndex];
    if (!piece) continue;

    for (const cardName of shuffledCards) {
      // Try a spread of destinations around the piece
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const toRow = piece.row + dr;
          const toCol = piece.col + dc;
          if (toRow < 0 || toRow > 4 || toCol < 0 || toCol > 4) continue;

          try {
            const result = await post(
              `/api/game/${gameId}/move`,
              { pieceIndex, toRow, toCol, cardName },
              token
            );
            return result;
          } catch {
            // Invalid move — try next
          }
        }
      }
    }
  }
  return null;
}

// ── WebSocket user (lobby matchmaking) ──────────────────────────────────────

function connectWebSocket(token, username) {
  if (!ENABLE_WEBSOCKETS) return null;

  const socket = ioClient(TARGET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 5000,
  });

  socket.on('connect', () => {
    stats.wsConnections++;
    socket.emit('lobby:join');
  });

  socket.on('lobby:matched', ({ gameId, playerNumber, gameState }) => {
    // Matched — just hold the connection; the game state keeps the server busy
    console.log(`[ws] ${username} matched as player ${playerNumber} in game ${gameId}`);
  });

  socket.on('disconnect', () => {
    stats.wsConnections--;
  });

  socket.on('connect_error', () => {
    stats.errors++;
  });

  return socket;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

async function runUser(userId) {
  const username = `loadtest_user_${userId}`;
  const password = 'loadtest123456';

  try {
    const token = await registerOrLogin(username, password);

    // Open a persistent WebSocket connection
    const socket = connectWebSocket(token, username);

    // Play AI games in a loop
    while (true) {
      try {
        await playAIGame(token, 'hard');
      } catch (err) {
        console.error(`[user ${userId}] game error: ${err.message}`);
      }
      await sleep(CYCLE_DELAY_MS * 2);
    }
  } catch (err) {
    console.error(`[user ${userId}] fatal: ${err.message}`);
  }
}

async function main() {
  console.log(`Load generator starting — target=${TARGET_URL} users=${CONCURRENT_USERS} rampUp=${RAMP_UP_SECONDS}s`);

  // Wait for app to be reachable
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await get('/api/health');
      console.log('App is reachable');
      break;
    } catch {
      console.log(`Waiting for app (attempt ${attempt + 1}/30)...`);
      await sleep(5000);
    }
  }

  // Ramp up users gradually
  const delayBetweenUsers = (RAMP_UP_SECONDS * 1000) / CONCURRENT_USERS;

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    runUser(i); // fire-and-forget — each user runs independently
    console.log(`Spawned user ${i + 1}/${CONCURRENT_USERS}`);
    await sleep(delayBetweenUsers);
  }

  console.log(`All ${CONCURRENT_USERS} users spawned`);
}

main().catch(console.error);
