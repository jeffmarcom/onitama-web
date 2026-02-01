import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let server;
const app = express();
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
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

server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
