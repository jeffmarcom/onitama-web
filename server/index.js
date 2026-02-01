import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let server;
const app = express();
const PORT = process.env.PORT || 3000;

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

// Health check route for Docker HEALTHCHECK and load balancers
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
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
