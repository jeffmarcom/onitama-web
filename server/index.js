import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { OnitamaGame } from './game-logic.js';
import { OnitamaAI } from './ai.js';
import { users, games, stats } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'onitama-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Active games in memory
const activeGames = new Map();
const aiInstances = new Map();

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be 3+ chars, password 6+ chars' });
    }
    
    // Check if user exists
    const existingUser = await users.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = {
      id: crypto.randomUUID(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    
    await users.create(user);
    
    // Generate token
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    
    res.json({ 
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Find user
    const user = await users.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    
    res.json({ 
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Game routes
app.post('/api/game/new', authenticateToken, async (req, res) => {
  try {
    const { difficulty = 'medium' } = req.body;
    
    // Create new game
    const game = new OnitamaGame(req.user.username, 'AI');
    activeGames.set(game.id, game);
    
    // Create AI instance
    const ai = new OnitamaAI(difficulty);
    aiInstances.set(game.id, ai);
    
    // If AI starts first, make its move immediately
    if (game.currentPlayer === 2) {
      setTimeout(async () => {
        const aiMove = ai.getBestMove(game, 2);
        if (aiMove) {
          game.makeMove(2, aiMove.pieceIndex, aiMove.to.row, aiMove.to.col, aiMove.cardName);
          await games.save(game.id, game.getState());
        }
      }, 500);
    }
    
    // Save game state
    await games.save(game.id, game.getState());
    
    res.json({ 
      gameId: game.id,
      gameState: game.getState()
    });
  } catch (error) {
    console.error('New game error:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

app.get('/api/game/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    let game = activeGames.get(id);
    
    if (!game) {
      // Try loading from storage
      const savedState = await games.get(id);
      if (!savedState) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      // Reconstruct game from saved state
      game = Object.assign(new OnitamaGame(), savedState);
      activeGames.set(id, game);
    }
    
    res.json({ gameState: game.getState() });
  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({ error: 'Failed to get game' });
  }
});

app.post('/api/game/:id/move', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { pieceIndex, toRow, toCol, cardName } = req.body;
    
    const game = activeGames.get(id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Verify it's player's turn
    if (game.currentPlayer !== 1) {
      return res.status(400).json({ error: 'Not your turn' });
    }
    
    // Make player move
    const result = game.makeMove(1, pieceIndex, toRow, toCol, cardName);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    // Save game state
    await games.save(id, game.getState());
    
    // Check if game ended
    if (game.winner) {
      const playerResult = game.winner === 1 ? 'win' : 'loss';
      await stats.update(req.user.username, playerResult);
      
      return res.json({ 
        gameState: game.getState(),
        gameEnded: true
      });
    }
    
    // AI's turn
    if (game.currentPlayer === 2) {
      setTimeout(async () => {
        const ai = aiInstances.get(id);
        if (ai && !game.winner) {
          const aiMove = ai.getBestMove(game, 2);
          
          if (aiMove) {
            game.makeMove(2, aiMove.pieceIndex, aiMove.to.row, aiMove.to.col, aiMove.cardName);
            await games.save(id, game.getState());
            
            // Check if AI won
            if (game.winner === 2) {
              await stats.update(req.user.username, 'loss');
            }
          }
        }
      }, 500); // Slight delay for better UX
    }
    
    res.json({ 
      gameState: game.getState(),
      gameEnded: false
    });
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: 'Failed to make move' });
  }
});

app.post('/api/game/:id/resign', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const game = activeGames.get(id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    game.winner = 2;
    game.winCondition = 'Resignation';
    
    await games.save(id, game.getState());
    await stats.update(req.user.username, 'loss');
    
    res.json({ 
      gameState: game.getState()
    });
  } catch (error) {
    console.error('Resign error:', error);
    res.status(500).json({ error: 'Failed to resign' });
  }
});

// Leaderboard route
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await stats.getLeaderboard();
    res.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Onitama server running on port ${PORT}`);
});
