import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { initializeGame, isValidMove, makeMove, getAIMove } from './gameEngine.js';
import { lobby } from './lobby.js';

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

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// Helper functions for JSON file database
async function readJSON(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJSON(filePath, defaultValue);
      return defaultValue;
    }
    throw err;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

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
    credentials: true
  },
  // Force WebSocket-only transport for Cloud Run compatibility
  transports: ['websocket'],
  // Increase timeout for Cloud Run (max 60 minutes)
  pingTimeout: 60000,
  pingInterval: 25000
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
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
  socket.on('lobby:join', () => {
    const match = lobby.joinQueue(socket.id, socket.user.username);
    
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
        updatedAt: new Date().toISOString()
      };
      
      // Save game
      (async () => {
        try {
          const games = await readJSON(GAMES_FILE, []);
          games.push(game);
          await writeJSON(GAMES_FILE, games);
        } catch (error) {
          console.error('Error saving PvP game:', error);
        }
      })();
      
      // Register game in lobby
      lobby.registerGame(
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
        gameState: { ...gameState, id: gameId }
      });
      
      io.to(match.player2SocketId).emit('lobby:matched', {
        gameId,
        playerNumber: 2,
        opponentUsername: match.player1Username,
        gameState: { ...gameState, id: gameId }
      });
    } else {
      // Added to queue, waiting for opponent
      socket.emit('lobby:waiting');
    }
  });
  
  // Leave lobby queue
  socket.on('lobby:leave', () => {
    const removed = lobby.leaveQueue(socket.id);
    if (removed) {
      socket.emit('lobby:left');
    }
  });
  
  // Make a move in PvP game
  socket.on('game:move', async ({ gameId, pieceIndex, toRow, toCol, cardName }) => {
    try {
      const gameInfo = lobby.getGame(gameId);
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
      
      // Get current game state from storage
      const games = await readJSON(GAMES_FILE, []);
      const gameIndex = games.findIndex(g => g.id === gameId);
      
      if (gameIndex === -1) {
        return socket.emit('game:error', { error: 'Game not found in storage' });
      }
      
      const game = games[gameIndex];
      
      // Check if game is over
      if (game.state.winner) {
        return socket.emit('game:error', { error: 'Game is already over' });
      }
      
      // Check if it's player's turn
      if (game.state.currentPlayer !== playerNumber) {
        return socket.emit('game:error', { error: 'Not your turn' });
      }
      
      // Validate and make move
      if (!isValidMove(game.state, playerNumber, pieceIndex, toRow, toCol, cardName)) {
        return socket.emit('game:error', { error: 'Invalid move' });
      }
      
      game.state = makeMove(game.state, playerNumber, pieceIndex, toRow, toCol, cardName);
      game.updatedAt = new Date().toISOString();
      
      // Check if player won
      if (game.state.winner) {
        const winnerUsername = game.state.winner === 1 ? game.player1Username : game.player2Username;
        const loserUsername = game.state.winner === 1 ? game.player2Username : game.player1Username;
        
        // Update stats
        const stats = await readJSON(STATS_FILE, {});
        if (!stats[winnerUsername]) {
          stats[winnerUsername] = { wins: 0, losses: 0, gamesPlayed: 0 };
        }
        if (!stats[loserUsername]) {
          stats[loserUsername] = { wins: 0, losses: 0, gamesPlayed: 0 };
        }
        
        stats[winnerUsername].wins++;
        stats[winnerUsername].gamesPlayed++;
        stats[loserUsername].losses++;
        stats[loserUsername].gamesPlayed++;
        
        await writeJSON(STATS_FILE, stats);
        
        // Remove game from active games
        lobby.removeGame(gameId);
      }
      
      // Save updated game state
      games[gameIndex] = game;
      await writeJSON(GAMES_FILE, games);
      
      // Broadcast updated state to both players
      const stateWithId = { ...game.state, id: gameId };
      io.to(gameInfo.player1SocketId).emit('game:state', { gameState: stateWithId });
      io.to(gameInfo.player2SocketId).emit('game:state', { gameState: stateWithId });
      
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('game:error', { error: 'Internal server error' });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
    
    const disconnectInfo = lobby.handleDisconnect(socket.id);
    
    if (disconnectInfo && disconnectInfo.opponentSocketId) {
      // Notify opponent of disconnect
      io.to(disconnectInfo.opponentSocketId).emit('game:opponent_disconnected', {
        gameId: disconnectInfo.gameId,
        username: disconnectInfo.disconnectedUsername
      });
    }
  });
});

// Health check route for Docker HEALTHCHECK and load balancers
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
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

    const users = await readJSON(USERS_FILE);

    // Check if username already exists
    if (users.some(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    await writeJSON(USERS_FILE, users);

    // Initialize user stats
    const stats = await readJSON(STATS_FILE, {});
    stats[username] = { wins: 0, losses: 0, gamesPlayed: 0 };
    await writeJSON(STATS_FILE, stats);

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET_TO_USE,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { username: user.username }
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

    const users = await readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET_TO_USE,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { username: user.username }
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

// Leaderboard route
app.get('/api/leaderboard', async (req, res) => {
  try {
    const stats = await readJSON(STATS_FILE, {});
    
    const leaderboard = Object.entries(stats)
      .map(([username, data]) => ({
        username,
        wins: data.wins || 0,
        losses: data.losses || 0,
        gamesPlayed: data.gamesPlayed || 0,
        winRate: data.gamesPlayed > 0 
          ? Math.round((data.wins / data.gamesPlayed) * 100)
          : 0
      }))
      .sort((a, b) => {
        // Sort by wins first, then by win rate
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.winRate - a.winRate;
      });

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

    // Validate difficulty
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty level' });
    }

    // Initialize new game
    const gameState = initializeGame();
    const gameId = uuidv4();

    // Create game record (AI game)
    const game = {
      id: gameId,
      gameType: 'ai',
      username,
      difficulty,
      state: gameState,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save game
    let games = await readJSON(GAMES_FILE, []);
    // Ensure games is an array (migrate from object format if needed)
    if (!Array.isArray(games)) {
      games = [];
    }
    games.push(game);
    await writeJSON(GAMES_FILE, games);

    // Add game ID to state for client convenience
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

    const games = await readJSON(GAMES_FILE, []);
    const game = games.find(g => g.id === gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Verify game belongs to user
    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Add game ID to state for client convenience
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

    // Validate input
    if (pieceIndex === undefined || toRow === undefined || toCol === undefined || !cardName) {
      return res.status(400).json({ error: 'Missing move parameters' });
    }

    const games = await readJSON(GAMES_FILE, []);
    const gameIndex = games.findIndex(g => g.id === gameId);

    if (gameIndex === -1) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = games[gameIndex];

    // Verify game belongs to user
    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if game is over
    if (game.state.winner) {
      return res.status(400).json({ error: 'Game is already over' });
    }

    // Check if it's player's turn
    if (game.state.currentPlayer !== 1) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    // Validate and make player move
    if (!isValidMove(game.state, 1, pieceIndex, toRow, toCol, cardName)) {
      return res.status(400).json({ error: 'Invalid move' });
    }

    game.state = makeMove(game.state, 1, pieceIndex, toRow, toCol, cardName);
    game.updatedAt = new Date().toISOString();

    // Check if player won with this move
    let playerWon = false;
    if (game.state.winner === 1) {
      playerWon = true;
      const stats = await readJSON(STATS_FILE, {});
      if (!stats[username]) {
        stats[username] = { wins: 0, losses: 0, gamesPlayed: 0 };
      }
      stats[username].gamesPlayed++;
      stats[username].wins++;
      await writeJSON(STATS_FILE, stats);
    }

    // Save player's move
    games[gameIndex] = game;
    await writeJSON(GAMES_FILE, games);

    // Send response with player's move immediately
    const stateWithId = { ...game.state, id: game.id };
    res.json({ gameState: stateWithId, gameEnded: playerWon });

    // If game not over and it's AI's turn, process AI move asynchronously
    if (!game.state.winner && game.state.currentPlayer === 2) {
      // Process AI move in background after delay (with optimistic concurrency)
      (async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Re-read game state to ensure we have latest
          const gamesAfterDelay = await readJSON(GAMES_FILE, []);
          const gameAfterDelay = gamesAfterDelay.find(g => g.id === gameId);
          if (!gameAfterDelay || gameAfterDelay.state.winner) return;

          // Version for optimistic concurrency: compare before write
          const readUpdatedAt = gameAfterDelay.updatedAt;

          const aiMove = getAIMove(gameAfterDelay.state, gameAfterDelay.difficulty);
          if (!aiMove) return;

          gameAfterDelay.state = makeMove(
            gameAfterDelay.state,
            2,
            aiMove.pieceIndex,
            aiMove.toRow,
            aiMove.toCol,
            aiMove.cardName
          );
          gameAfterDelay.updatedAt = new Date().toISOString();

          // Check if AI won (for stats; will persist only if write succeeds)
          const aiWon = gameAfterDelay.state.winner === 2;

          // Optimistic concurrency: only write if stored game version matches what we read
          const finalGames = await readJSON(GAMES_FILE, []);
          const finalGameIndex = finalGames.findIndex(g => g.id === gameId);
          if (finalGameIndex === -1) return;

          const currentGame = finalGames[finalGameIndex];
          if (currentGame.updatedAt !== readUpdatedAt) {
            // Conflict: someone else updated the game; apply AI move to latest state instead
            console.log('AI move: conflict detected, applying move to latest state', gameId);
            if (currentGame.state.winner) return; // Game ended, skip AI move
            const aiMoveLatest = getAIMove(currentGame.state, currentGame.difficulty);
            if (!aiMoveLatest) return;
            currentGame.state = makeMove(
              currentGame.state,
              2,
              aiMoveLatest.pieceIndex,
              aiMoveLatest.toRow,
              aiMoveLatest.toCol,
              aiMoveLatest.cardName
            );
            currentGame.updatedAt = new Date().toISOString();
            finalGames[finalGameIndex] = currentGame;

            if (currentGame.state.winner === 2) {
              const stats = await readJSON(STATS_FILE, {});
              if (!stats[username]) {
                stats[username] = { wins: 0, losses: 0, gamesPlayed: 0 };
              }
              stats[username].gamesPlayed++;
              stats[username].losses++;
              await writeJSON(STATS_FILE, stats);
            }
          } else {
            // No conflict: write our computed state; replace only the matching game by index
            finalGames[finalGameIndex] = gameAfterDelay;
            if (aiWon) {
              const stats = await readJSON(STATS_FILE, {});
              if (!stats[username]) {
                stats[username] = { wins: 0, losses: 0, gamesPlayed: 0 };
              }
              stats[username].gamesPlayed++;
              stats[username].losses++;
              await writeJSON(STATS_FILE, stats);
            }
          }

          await writeJSON(GAMES_FILE, finalGames);
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

    const games = await readJSON(GAMES_FILE, []);
    const gameIndex = games.findIndex(g => g.id === gameId);

    if (gameIndex === -1) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = games[gameIndex];

    // Verify game belongs to user
    if (game.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if game is already over
    if (game.state.winner) {
      return res.status(400).json({ error: 'Game is already over' });
    }

    // Set AI as winner
    game.state.winner = 2;
    game.state.winCondition = 'Resignation';
    game.updatedAt = new Date().toISOString();

    // Update stats
    const stats = await readJSON(STATS_FILE, {});
    if (!stats[username]) {
      stats[username] = { wins: 0, losses: 0, gamesPlayed: 0 };
    }

    stats[username].gamesPlayed++;
    stats[username].losses++;

    await writeJSON(STATS_FILE, stats);

    // Save updated game
    games[gameIndex] = game;
    await writeJSON(GAMES_FILE, games);

    // Add game ID to state for client convenience
    const stateWithId = { ...game.state, id: game.id };
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
  console.log('Socket.IO initialized for real-time communication');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
