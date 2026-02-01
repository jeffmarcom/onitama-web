import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Health check route for Docker HEALTHCHECK and load balancers
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve built frontend from dist
app.use(express.static(path.join(__dirname, '..', 'dist')));

// SPA fallback: serve index.html for non-API routes; let API paths fall through to 404
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});})

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
// API 404: unknown /api/* routes get JSON 404 (reached only when SPA fallback called next())
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
