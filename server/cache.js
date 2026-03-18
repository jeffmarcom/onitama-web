import Redis from 'ioredis';

function normalizeRedisUrl(url) {
  if (!url) return url;

  // DigitalOcean Managed Valkey uses a Redis-compatible protocol but may provide a `valkey://` URI.
  // `ioredis` expects `redis://` or `rediss://`, so normalize the scheme.
  return url
    .replace(/^valkey\+ssl:\/\//i, 'rediss://')
    .replace(/^valkey:\/\//i, 'redis://');
}

// Prefer REDIS_URL for backward compatibility; allow VALKEY_URL for Managed Valkey deployments.
const REDIS_URL = normalizeRedisUrl(process.env.REDIS_URL || process.env.VALKEY_URL || 'redis://localhost:6379');

// Main client for caching
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null; // stop retrying
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

// ── Cache keys & TTLs ──────────────────────────────────────────────────────

const LEADERBOARD_KEY = 'cache:leaderboard';
const LEADERBOARD_TTL = 30; // seconds

// ── Leaderboard cache ───────────────────────────────────────────────────────

export async function getCachedLeaderboard() {
  try {
    const cached = await redis.get(LEADERBOARD_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error('Redis get error:', err.message);
  }
  return null;
}

export async function setCachedLeaderboard(leaderboard) {
  try {
    await redis.set(LEADERBOARD_KEY, JSON.stringify(leaderboard), 'EX', LEADERBOARD_TTL);
  } catch (err) {
    console.error('Redis set error:', err.message);
  }
}

export async function invalidateLeaderboard() {
  try {
    await redis.del(LEADERBOARD_KEY);
  } catch (err) {
    console.error('Redis del error:', err.message);
  }
}

// ── Health check ────────────────────────────────────────────────────────────

export async function healthCheck() {
  const result = await redis.ping();
  return result === 'PONG';
}

// ── Socket.IO adapter clients ───────────────────────────────────────────────
// The Redis adapter needs two separate clients (pub/sub)

export function createAdapterClients() {
  const pubClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  const subClient = pubClient.duplicate();
  return { pubClient, subClient };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function connectRedis() {
  await redis.connect();
}

export async function closeRedis() {
  await redis.quit();
}

export default redis;
