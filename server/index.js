import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { initializeGame, isValidMove, makeMove, getAIMove } from './gameEngine.js';
import { lobby } from './lobby.js';
import {
  initDB, getUserByUsername, createUser as dbCreateUser, createGame as dbCreateGame,
  getGame, updateGameState, updateGameStateOptimistic, ensureStats,
  recordWin, recordLoss, getLeaderboard as dbGetLeaderboard,
  healthCheck as dbHealthCheck, closePool,
} from './db.js';
import {
  connectRedis, closeRedis, createAdapterClients,
  getCachedLeaderboard, setCachedLeaderboard, invalidateLeaderboard,
  healthCheck as cacheHealthCheck,
} from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// JWT secret - no default in production; dev-only fallback with warning
const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production') {
  if (!JWT_SECRET || JWT_SECRET.trim() === '') {
    console.error('Fatal: JWT_SECRET must be set in production.');
    process.exit(1);
  }
} else if (!JWT_SECRET || JWT_SECRET.trim() === '') {
  console.warn('Warning: JWT_SECRET not set; using dev-only fallback. Set JWT_SECRET in production.');
}
const JWT_SECRET_TO_USE = JWT_SECRET?.trim() || 'dev-only-fallback-change-in-production';

// ── Initialize data stores ──────────────────────────────────────────────────

await connectRedis();
await initDB();

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET_TO_USE, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: allowedOrigins,
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
  })
);

app.use(express.json());

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Attach Redis adapter for cross-pod pub/sub
const { pubClient, subClient } = createAdapterClients();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
console.log('Socket.IO Redis adapter attached');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
  skip: (req) => req.headers['x-load-test'] === process.env.LOAD_TEST_KEY,
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  jwt.verify(token, JWT_SECRET_TO_USE, (err, user) => {
    if (err) {
      return next(new Error('Invalid token'));
    }
    socket.user = user;
    next();
  });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);
  
  // Join lobby queue
  socket.on('lobby:join', async () => {
    const match = await lobby.joinQueue(socket.id, socket.user.username);

    if (match) {
      // Match found! Create a new PvP game
      const gameState = initializeGame();
      const gameId = uuidv4();

      const game = {
        id: gameId,
        gameType: 'pvp',
        player1Username: match.player1Username,
        player2Username: match.player2Username,
        state: gameState,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save game to database
      dbCreateGame(game).catch((error) => {
        console.error('Error saving PvP game:', error);
      });

      // Register game in lobby
      await lobby.registerGame(
        gameId,
        match.player1SocketId,
        match.player2SocketId,
        match.player1Username,
        match.player2Username
      );
      
      // Notify both players
      io.to(match.player1SocketId).emit('lobby:matched', {
        gameId,
        playerNumber: 1,
        opponentUsername: match.player2Username,
        gameState: { ...gameState, id: gameId },
      });

      io.to(match.player2SocketId).emit('lobby:matched', {
        gameId,
        playerNumber: 2,
        opponentUsername: match.player1Username,
        gameState: { ...gameState, id: gameId },
      });
    } else {
      // Added to queue, waiting for opponent
      socket.emit('lobby:waiting');
    }
  });
  
  // Leave lobby queue
  socket.on('lobby:leave', async () => {
    const removed = await lobby.leaveQueue(socket.id);
    if (removed) {
      socket.emit('lobby:left');
    }
  });
  
  // Make a move in PvP game
  socket.on('game:move', async ({ gameId, pieceIndex, toRow, toCol, cardName }) => {
    try {
      const gameInfo = await lobby.getGame(gameId);
      if (!gameInfo) {
        return socket.emit('game:error', { error: 'Game not found' });
      }

      // Determine which player is making the move
      let playerNumber;
      if (gameInfo.player1SocketId === socket.id) {
        playerNumber = 1;
      } else if (gameInfo.player2SocketId === socket.id) {
        playerNumber = 2;
      } else {
        return socket.emit('game:error', { error: 'Not a player in this game' });
      }

      // Get current game state from database
      const game = await getGame(gameId);

      if (!game) {
        return socket.emit('game:error', { error: 'Game not found in storage' });
      }

      if (game.state.winner) {
        return socket.emit('game:error', { error: 'Game is already over' });
      }

      if (game.state.currentPlayer !== playerNumber) {
        return socket.emit('game:error', { error: 'Not your turn' });
      }

      if (!isValidMove(game.state, playerNumber, pieceIndex, toRow, toCol, cardName)) {
        return socket.emit('game:error', { error: 'Invalid move' });
      }

      const newState = makeMove(game.state, playerNumber, pieceIndex, toRow, toCol, cardName);
      const updatedAt = new Date().toISOString();

      if (newState.winner) {
        const winnerUsername = newState.winner === 1 ? game.player1Username : game.player2Username;
        const loserUsername = newState.winner === 1 ? game.player2Username : game.player1Username;

        await Promise.all([
          recordWin(winnerUsername),
          recordLoss(loserUsername),
          invalidateLeaderboard(),
        ]);

        await lobby.removeGame(gameId);
      }

      await updateGameState(gameId, newState, updatedAt);

      const stateWithId = { ...newState, id: gameId };
      io.to(gameInfo.player1SocketId).emit('game:state', { gameState: stateWithId });
      io.to(gameInfo.player2SocketId).emit('game:state', { gameState: stateWithId });
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('game:error', { error: 'Internal server error' });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.user.username} (${socket.id})`);

    const disconnectInfo = await lobby.handleDisconnect(socket.id);
    
    if (disconnectInfo && disconnectInfo.opponentSocketId) {
      // Notify opponent of disconnect
      io.to(disconnectInfo.opponentSocketId).emit('game:opponent_disconnected', {
        gameId: disconnectInfo.gameId,
        username: disconnectInfo.disconnectedUsername
      });
    }
  });
});

// Health check — verifies DB and Redis connectivity
app.get('/api/health', async (_req, res) => {
  try {
    const [dbOk, cacheOk] = await Promise.all([dbHealthCheck(), cacheHealthCheck()]);
    if (dbOk && cacheOk) {
      return res.status(200).json({ status: 'ok', db: 'ok', cache: 'ok' });
    }
    res.status(503).json({ status: 'degraded', db: dbOk ? 'ok' : 'down', cache: cacheOk ? 'ok' : 'down' });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

// Auth routes
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if username already exists
    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    await dbCreateUser(userId, username, hashedPassword);

    // Initialize user stats
    await ensureStats(username);

    // Generate JWT token
    const token = jwt.sign(
      { id: userId, username },
      JWT_SECRET_TO_USE,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { username },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET_TO_USE,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { username: user.username },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected: profile (requires authentication)
app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Leaderboard route (Redis-cached)
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Try cache first
    const cached = await getCachedLeaderboard();
    if (cached) {
      return res.json({ leaderboard: cached });
    }

    // Cache miss — query database
    const leaderboard = await dbGetLeaderboard();
    await setCachedLeaderboard(leaderboard);

    res.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Game routes
app.post('/api/game/new', authenticateToken, async (req, res) => {
  try {
    const { difficulty = 'medium' } = req.body;
    const username = req.user.username;

    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty level' });
    }

    const gameState = initializeGame();
    const gameId = uuidv4();

    const game = {
      id: gameId,
      gameType: 'ai',
      username,
      difficulty,
      state: gameState,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbCreateGame(game);

    const stateWithId = { ...gameState, id: gameId };
    res.status(201).json({ gameId, gameState: stateWithId });
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/game/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const username = req.user.username;

    const game = await getGame(gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stateWithId = { ...game.state, id: game.id };
    res.json({ gameState: stateWithId });
  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/game/:id/move', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const username = req.user.username;
    const { pieceIndex, toRow, toCol, cardName } = req.body;

    if (pieceIndex === undefined || toRow === undefined || toCol === undefined || !cardName) {
      return res.status(400).json({ error: 'Missing move parameters' });
    }

    const game = await getGame(gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (game.state.winner) {
      return res.status(400).json({ error: 'Game is already over' });
    }

    if (game.state.currentPlayer !== 1) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    if (!isValidMove(game.state, 1, pieceIndex, toRow, toCol, cardName)) {
      return res.status(400).json({ error: 'Invalid move' });
    }

    const newState = makeMove(game.state, 1, pieceIndex, toRow, toCol, cardName);
    const updatedAt = new Date().toISOString();

    let playerWon = false;
    if (newState.winner === 1) {
      playerWon = true;
      await Promise.all([recordWin(username), invalidateLeaderboard()]);
    }

    await updateGameState(gameId, newState, updatedAt);

    const stateWithId = { ...newState, id: gameId };
    res.json({ gameState: stateWithId, gameEnded: playerWon });

    // If game not over and it's AI's turn, process AI move asynchronously
    if (!newState.winner && newState.currentPlayer === 2) {
      (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));

          const gameAfterDelay = await getGame(gameId);
          if (!gameAfterDelay || gameAfterDelay.state.winner) return;

          const readUpdatedAt = gameAfterDelay.updatedAt;

          const aiMove = getAIMove(gameAfterDelay.state, gameAfterDelay.difficulty);
          if (!aiMove) return;

          const aiState = makeMove(
            gameAfterDelay.state, 2,
            aiMove.pieceIndex, aiMove.toRow, aiMove.toCol, aiMove.cardName
          );
          const aiUpdatedAt = new Date().toISOString();

          // Optimistic concurrency via updated_at check
          const written = await updateGameStateOptimistic(gameId, aiState, aiUpdatedAt, readUpdatedAt);

          if (!written) {
            console.log('AI move: conflict detected, retrying', gameId);
            const latest = await getGame(gameId);
            if (!latest || latest.state.winner) return;
            const retry = getAIMove(latest.state, latest.difficulty);
            if (!retry) return;
            const retryState = makeMove(
              latest.state, 2,
              retry.pieceIndex, retry.toRow, retry.toCol, retry.cardName
            );
            await updateGameState(gameId, retryState, new Date().toISOString());
            if (retryState.winner === 2) {
              await Promise.all([recordLoss(username), invalidateLeaderboard()]);
            }
          } else if (aiState.winner === 2) {
            await Promise.all([recordLoss(username), invalidateLeaderboard()]);
          }
        } catch (error) {
          console.error('AI move error:', error);
        }
      })();
    }
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/game/:id/resign', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const username = req.user.username;

    const game = await getGame(gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (game.state.winner) {
      return res.status(400).json({ error: 'Game is already over' });
    }

    const newState = { ...game.state, winner: 2, winCondition: 'Resignation' };
    const updatedAt = new Date().toISOString();

    await Promise.all([
      updateGameState(gameId, newState, updatedAt),
      recordLoss(username),
      invalidateLeaderboard(),
    ]);

    const stateWithId = { ...newState, id: gameId };
    res.json({ gameState: stateWithId });
  } catch (error) {
    console.error('Resign error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve built frontend from dist
app.use(express.static(path.join(__dirname, '..', 'dist')));

// SPA fallback: serve index.html for non-API routes; let API paths fall through to 404
app.get('*', (req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    next();
  }
});

// API 404: unknown /api/* routes get JSON 404 (reached only when SPA fallback called next())
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Fallback for non-GET requests: do not serve HTML (avoids masking CORS preflight and API errors)
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Socket.IO initialized with Redis adapter for cross-pod communication');
});

// ── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown() {
  console.log('Shutting down gracefully...');
  httpServer.close(async () => {
    await Promise.all([
      closePool(),
      closeRedis(),
      pubClient.quit(),
      subClient.quit(),
    ]);
    console.log('All connections closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
