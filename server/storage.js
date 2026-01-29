import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Read JSON file
async function readJSON(filename) {
  await ensureDataDir();
  const filepath = path.join(DATA_DIR, filename);
  
  try {
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist
    }
    throw error;
  }
}

// Write JSON file
async function writeJSON(filename, data) {
  await ensureDataDir();
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

// User storage
export const users = {
  async getAll() {
    const data = await readJSON('users.json');
    return data || [];
  },
  
  async findByUsername(username) {
    const allUsers = await this.getAll();
    return allUsers.find(u => u.username === username);
  },
  
  async create(user) {
    const allUsers = await this.getAll();
    allUsers.push(user);
    await writeJSON('users.json', allUsers);
    return user;
  }
};

// Game storage
export const games = {
  async getAll() {
    const data = await readJSON('games.json');
    return data || {};
  },
  
  async get(gameId) {
    const allGames = await this.getAll();
    return allGames[gameId];
  },
  
  async save(gameId, gameState) {
    const allGames = await this.getAll();
    allGames[gameId] = gameState;
    await writeJSON('games.json', allGames);
  },
  
  async delete(gameId) {
    const allGames = await this.getAll();
    delete allGames[gameId];
    await writeJSON('games.json', allGames);
  }
};

// Stats storage
export const stats = {
  async getAll() {
    const data = await readJSON('stats.json');
    return data || {};
  },
  
  async get(username) {
    const allStats = await this.getAll();
    return allStats[username] || {
      username,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      winRate: 0
    };
  },
  
  async update(username, result) {
    const allStats = await this.getAll();
    const userStats = allStats[username] || {
      username,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      winRate: 0
    };
    
    userStats.gamesPlayed++;
    if (result === 'win') {
      userStats.wins++;
    } else if (result === 'loss') {
      userStats.losses++;
    }
    
    userStats.winRate = userStats.gamesPlayed > 0 
      ? (userStats.wins / userStats.gamesPlayed * 100).toFixed(1)
      : 0;
    
    allStats[username] = userStats;
    await writeJSON('stats.json', allStats);
    return userStats;
  },
  
  async getLeaderboard() {
    const allStats = await this.getAll();
    return Object.values(allStats)
      .sort((a, b) => b.wins - a.wins);
  }
};
