# Onitama Web

A web-based implementation of the abstract strategy board game Onitama. Built with React, TypeScript, and Express.

## About Onitama

Onitama is a two-player perfect information abstract strategy game. Players take turns moving their pieces on a 5x5 board using movement cards. The goal is to either capture your opponent's Master piece or move your Master to your opponent's temple.

## Features

- **Interactive Tutorial**: Learn how to play with a step-by-step guided tutorial
- **Multiple Difficulty Levels**: Play against AI opponents at Easy, Medium, and Hard difficulty
- **User Authentication**: Secure login system with JWT tokens and bcrypt password hashing
- **Leaderboard**: Track top players and their win records
- **Responsive UI**: Clean, modern interface that works on desktop and mobile
- **Real-time Gameplay**: Smooth game mechanics with move validation

## Tech Stack

**Frontend:**
- React 18 with TypeScript
- React Router for navigation
- Vite for build tooling

**Backend:**
- Express.js server
- JWT authentication
- PostgreSQL for persistent storage
- Redis for caching and Socket.IO cross-pod pub/sub
- Rate limiting for API protection

**DevOps:**
- Docker containerization
- Helm chart for Kubernetes deployment
- HorizontalPodAutoscaler (CPU-based)
- DigitalOcean Kubernetes (DOKS) with Load Balancer
- Make-based workflow automation

## Getting Started

### Prerequisites

- Docker and Docker Desktop installed
- Make (comes pre-installed on macOS/Linux)

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/jeffmarcom/onitama-web.git
cd onitama-web
```

2. Run the development environment:
```bash
make dev
```

3. Open your browser to [http://localhost:3000](http://localhost:3000)

### Available Make Commands

- `make help` - Show all available commands
- `make dev` - Run development environment in Docker
- `make build` - Build Docker image
- `make logs` - View container logs
- `make clean` - Stop and remove containers/images
- `make deploy` - Deploy to GCP Cloud Run
- `make doks-setup` - Create DOKS cluster and container registry
- `make doks-push` - Build and push images to DO registry
- `make doks-deploy` - Deploy to DOKS via Helm
- `make doks-status` - Show cluster status
- `make doks-loadtest` - Enable the load generator
- `make doks-teardown` - Delete all cloud resources

## Development

### Local Development (without Docker)

If you prefer to run the app locally without Docker:

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

This will start both the Express backend (port 3000) and Vite frontend dev server (port 5173).

### Project Structure

```
onitama-web/
├── src/                  # Frontend React application
│   ├── App.tsx          # Main app component with routing
│   ├── main.tsx         # React entry point
│   ├── index.css        # Global styles
│   ├── pages/           # Page components
│   │   ├── Login.tsx
│   │   ├── Game.tsx
│   │   ├── HowToPlay.tsx
│   │   └── Leaderboard.tsx
│   └── utils/
│       └── cards.ts     # Card movement definitions
├── server/              # Backend Express application
│   ├── index.js        # Server entry point & API routes
│   └── gameEngine.js   # Game logic and AI
├── data/               # Persistent data storage (git-ignored)
├── Dockerfile          # Container configuration
├── Makefile           # Build and deployment automation
└── package.json       # Dependencies and scripts
```

### Environment Variables

The application uses the following environment variables:

- `JWT_SECRET` - Secret key for JWT token signing (default: "dev-local-secret-change-in-production")
- `PORT` - Server port (default: 3000)

**Important:** Change `JWT_SECRET` in production!

## Game Rules

Each player starts with:
- 1 Master piece (👑) in the center
- 4 Student pieces (🥋) on either side
- 2 movement cards

**Objective:**
- Capture the opponent's Master (Way of the Stone), or
- Move your Master to the opponent's temple (Way of the Stream)

**Gameplay:**
1. Select one of your pieces to see valid moves
2. Choose a move using one of your cards
3. After moving, exchange the used card with the side card
4. The side card goes to your opponent on their next turn

For a detailed tutorial, visit the "How to Play" page in the app.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and receive JWT token

### Game
- `POST /api/game/new` - Start a new game
- `POST /api/game/move` - Make a move
- `GET /api/game/:gameId` - Get game state

### Leaderboard
- `GET /api/leaderboard` - Get top 10 players

## Deployment

### Deploy to DigitalOcean Kubernetes (DOKS)

The recommended deployment path uses a Helm chart on DOKS. See [docs/setup-guide.md](docs/setup-guide.md) for full step-by-step instructions.

**Quick start:**

```bash
# Prerequisites: doctl, kubectl, helm, docker
doctl auth init
make doks-setup    # Create cluster (~5 min)
make doks-push     # Build and push images
make doks-deploy   # Deploy via Helm
make doks-status   # Check pods, services, HPA
```

The Helm chart deploys:
- Stateless app pods with HPA (auto-scales 2–8 based on CPU)
- In-cluster PostgreSQL with persistent storage
- In-cluster Redis for caching and WebSocket pub/sub
- DigitalOcean Load Balancer

For production, switch to DigitalOcean Managed Database and Managed Redis:

```bash
helm upgrade onitama ./chart/onitama \
  -f chart/onitama/values-production.yaml \
  --set secrets.databaseUrl="<MANAGED_DB_URL>" \
  --set secrets.redisUrl="<MANAGED_REDIS_URL>"
```

**Teardown** (stops all billing):

```bash
make doks-teardown
```

### Deploy to Google Cloud Run

Alternatively, deploy to Cloud Run for a simpler serverless setup:

```bash
gcloud auth login
gcloud config set project $GCP_PROJECT
make deploy
```

## Data Persistence

The application uses PostgreSQL for persistent storage:
- `users` table — User accounts and authentication
- `games` table — Active and completed games (JSONB state)
- `stats` table — Player win/loss statistics

Redis is used for:
- Leaderboard caching (30s TTL)
- Socket.IO cross-pod pub/sub (enables horizontal scaling of WebSocket connections)

**DOKS deployment**: Data persists in a PersistentVolumeClaim (DigitalOcean Block Storage).
**Production**: Use DigitalOcean Managed Database for automated backups and failover.

### Production checklist

Before treating this stack as production-ready, address the following (see [Architecture](docs/architecture.md) and [QBR Summary](docs/qbr-summary.md) for details):

| Item | Demo behavior | Production recommendation |
|------|----------------|---------------------------|
| **HTTPS** | Load Balancer and app serve HTTP only | Terminate TLS at the DigitalOcean Load Balancer (managed or uploaded certificate). |
| **VPC** | Managed DB and cache use public endpoints | Use VPC and private endpoints so DB/cache traffic does not cross the public internet; restrict DB firewall to app egress. |
| **HA** | Managed PostgreSQL and Valkey are single-node | Enable HA/failover for managed databases when budget allows. |
| **TTL / eviction** | Game session keys: 6h TTL; leaderboard cache: 30s TTL | Set Redis/Valkey eviction policy (e.g. `volatile-ttl` or `allkeys-lru`) when memory is constrained; tune TTLs as needed. |

## Documentation

- [Architecture](docs/architecture.md) — System design, component details, scaling behavior, and Mermaid diagram
- [Setup Guide](docs/setup-guide.md) — Step-by-step deployment instructions for DOKS
- [Infrastructure Review](docs/qbr-summary.md) — Cost analysis, scaling recommendations, and risk assessment

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Onitama is a game designed by Shimpei Sato and published by Arcane Wonders
- This is a fan-made digital implementation for educational purposes
