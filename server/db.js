import pg from 'pg';

const { Pool } = pg;

// Support DATABASE_URL (Managed DB / k8s secret) or individual vars
const DATABASE_URL = process.env.DATABASE_URL;

function buildPgPoolConfig() {
  let connectionString = DATABASE_URL;
  const config = {
    connectionString,
  };

  // Some managed Postgres providers use TLS and may present a certificate chain that
  // causes `node-postgres` to fail strict verification unless you provide CA bundle(s).
  // For this take-home, default to allowing such chains when SSL is clearly intended.
  //
  // Override by setting:
  //   PG_SSL_REJECT_UNAUTHORIZED=true  (strict verification)
  //   PG_SSL_REJECT_UNAUTHORIZED=false (allow self-signed chain)
  if (DATABASE_URL) {
    const sslLikely =
      /sslmode=/.test(DATABASE_URL) ||
      /(\.|-)k\.db\.ondigitalocean\.com\b/.test(DATABASE_URL);

    if (sslLikely) {
      const env = process.env.PG_SSL_REJECT_UNAUTHORIZED;
      const rejectUnauthorized = env ? env.toLowerCase() === 'true' : false;

      // `pg` may internally translate `sslmode=...` from the URL into its own `ssl` options
      // (potentially overwriting our explicit rejectUnauthorized). Strip sslmode so our `ssl`
      // option is authoritative.
      if (/sslmode=/.test(connectionString)) {
        try {
          const u = new URL(connectionString);
          u.searchParams.delete('sslmode');
          connectionString = u.toString();
          config.connectionString = connectionString;
        } catch {
          // If parsing fails, fall back to leaving the connection string unchanged.
        }
      }

      config.ssl = { rejectUnauthorized };
      // Avoid logging secrets; only expose whether SSL validation is disabled/enabled.
      console.log('[db] DATABASE_URL indicates SSL; setting pg ssl.rejectUnauthorized=', rejectUnauthorized);
    }
  }

  return config;
}

const pool = new Pool({
  ...buildPgPoolConfig(),
  // Fallback to individual env vars if DATABASE_URL is not set
  ...(DATABASE_URL
    ? {}
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        database: process.env.PGDATABASE || 'onitama',
        user: process.env.PGUSER || 'onitama',
        password: process.env.PGPASSWORD || 'onitama',
      }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// ── Schema ──────────────────────────────────────────────────────────────────

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password VARCHAR(128) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS games (
        id UUID PRIMARY KEY,
        game_type VARCHAR(8) NOT NULL DEFAULT 'ai',
        username VARCHAR(64),
        player1_username VARCHAR(64),
        player2_username VARCHAR(64),
        difficulty VARCHAR(8),
        state JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stats (
        username VARCHAR(64) PRIMARY KEY,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        games_played INT DEFAULT 0
      );
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// ── User helpers ────────────────────────────────────────────────────────────

export async function getUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username, password FROM users WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

export async function createUser(id, username, hashedPassword) {
  await pool.query(
    'INSERT INTO users (id, username, password) VALUES ($1, $2, $3)',
    [id, username, hashedPassword]
  );
}

// ── Game helpers ────────────────────────────────────────────────────────────

export async function createGame(game) {
  await pool.query(
    `INSERT INTO games (id, game_type, username, player1_username, player2_username, difficulty, state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      game.id,
      game.gameType,
      game.username || null,
      game.player1Username || null,
      game.player2Username || null,
      game.difficulty || null,
      JSON.stringify(game.state),
      game.createdAt,
      game.updatedAt,
    ]
  );
}

export async function getGame(gameId) {
  const { rows } = await pool.query(
    'SELECT id, game_type AS "gameType", username, player1_username AS "player1Username", player2_username AS "player2Username", difficulty, state, updated_at AS "updatedAt" FROM games WHERE id = $1',
    [gameId]
  );
  return rows[0] || null;
}

export async function updateGameState(gameId, state, updatedAt) {
  await pool.query(
    'UPDATE games SET state = $1, updated_at = $2 WHERE id = $3',
    [JSON.stringify(state), updatedAt, gameId]
  );
}

/**
 * Optimistic update: only writes if updated_at matches expectedUpdatedAt.
 * Returns true if the row was updated, false on conflict.
 */
export async function updateGameStateOptimistic(gameId, state, newUpdatedAt, expectedUpdatedAt) {
  const { rowCount } = await pool.query(
    'UPDATE games SET state = $1, updated_at = $2 WHERE id = $3 AND updated_at = $4',
    [JSON.stringify(state), newUpdatedAt, gameId, expectedUpdatedAt]
  );
  return rowCount > 0;
}

// ── Stats / Leaderboard helpers ─────────────────────────────────────────────

export async function ensureStats(username) {
  await pool.query(
    `INSERT INTO stats (username, wins, losses, games_played)
     VALUES ($1, 0, 0, 0)
     ON CONFLICT (username) DO NOTHING`,
    [username]
  );
}

export async function recordWin(username) {
  await pool.query(
    `INSERT INTO stats (username, wins, losses, games_played)
     VALUES ($1, 1, 0, 1)
     ON CONFLICT (username) DO UPDATE
       SET wins = stats.wins + 1, games_played = stats.games_played + 1`,
    [username]
  );
}

export async function recordLoss(username) {
  await pool.query(
    `INSERT INTO stats (username, wins, losses, games_played)
     VALUES ($1, 0, 1, 1)
     ON CONFLICT (username) DO UPDATE
       SET losses = stats.losses + 1, games_played = stats.games_played + 1`,
    [username]
  );
}

export async function getLeaderboard() {
  const { rows } = await pool.query(
    `SELECT username, wins, losses, games_played AS "gamesPlayed",
            CASE WHEN games_played > 0
              THEN ROUND((wins::numeric / games_played) * 100)
              ELSE 0
            END AS "winRate"
     FROM stats
     ORDER BY wins DESC, "winRate" DESC
     LIMIT 50`
  );
  return rows;
}

// ── Health check ────────────────────────────────────────────────────────────

export async function healthCheck() {
  const { rows } = await pool.query('SELECT 1');
  return rows.length === 1;
}

// ── Shutdown ────────────────────────────────────────────────────────────────

export async function closePool() {
  await pool.end();
}

export default pool;
