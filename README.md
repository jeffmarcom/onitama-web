# Onitama Web

A web-based implementation of the Onitama board game with AI opponent, user authentication, and stat tracking.

## About Onitama

Onitama is an elegant, abstract strategy game for two players inspired by Japanese martial arts. Players control a master and four students on a 5x5 board, using movement cards to determine how pieces can move.

**Win Conditions:**
- **Way of the Stone**: Capture your opponent's master
- **Way of the Stream**: Move your master to your opponent's temple (center of their starting row)

## Features

✅ Full game implementation with all 16 base game cards
✅ AI opponent with 3 difficulty levels (easy, medium, hard)
✅ User authentication (registration/login)
✅ Stat tracking and leaderboard
✅ Visual card representation showing movement patterns
✅ Docker containerization for easy deployment
✅ File-based persistence for local play

## Quick Start

### Prerequisites
- Docker installed on your system
- Make (optional, but recommended)

### Run Locally with Docker

```bash
# Using Make (recommended)
make dev

# Or manually
docker build -t onitama-web .
docker run -d --name onitama-web-container -p 3000:3000 -v $(pwd)/data:/app/data onitama-web
```

Then open your browser to http://localhost:3000

### Development Setup

If you want to run without Docker for development:

```bash
# Install dependencies
npm install

# Run development server (frontend + backend concurrently)
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Makefile Targets

```bash
make help          # Show available commands
make dev           # Build and run locally with Docker
make build         # Build Docker image
make clean         # Stop and remove containers/images
make logs          # View container logs
make prod-deploy   # TODO: GCP Cloud Run deployment (placeholder)
```

## Game Instructions

1. **Register/Login**: Create an account or login
2. **Start a Game**: Choose AI difficulty (Easy/Medium/Hard)
3. **Play**:
   - Select one of your pieces (green) by clicking on it
   - Select one of your two cards
   - Valid moves will be highlighted in green with circles
   - Click a highlighted square to move
   - The card you used goes to the side, you receive the side card
4. **Win**: Capture the opponent's master or reach their temple!

## Card Movement System

Each card shows a 5x5 grid with:
- **◆** (diamond) = Your piece's current position
- **●** (circle) = Valid move destinations

Cards rotate between players, creating dynamic gameplay where you must plan ahead knowing which cards will be available.

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express
- **Authentication**: JWT tokens + bcrypt
- **Storage**: JSON file-based (development)
- **AI**: Minimax algorithm with alpha-beta pruning
- **Container**: Docker (Alpine-based Node.js)

## Project Structure

```
onitama-web/
├── server/              # Backend Node.js server
│   ├── index.js        # Express server & API routes
│   ├── game-logic.js   # Onitama game engine
│   ├── ai.js           # AI opponent (minimax)
│   └── storage.js      # File-based data persistence
├── src/                # React frontend
│   ├── pages/          # Page components
│   │   ├── Login.tsx
│   │   ├── Game.tsx
│   │   └── Leaderboard.tsx
│   ├── utils/
│   │   └── cards.ts    # Card movement definitions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── data/               # Persistent data (gitignored)
│   ├── users.json
│   ├── games.json
│   └── stats.json
├── Dockerfile
├── Makefile
└── package.json
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login

### Game
- `POST /api/game/new` - Start new game
- `GET /api/game/:id` - Get game state
- `POST /api/game/:id/move` - Make a move
- `POST /api/game/:id/resign` - Resign game

### Leaderboard
- `GET /api/leaderboard` - Get player statistics

## Future Enhancements

- [ ] Real-time multiplayer with WebSockets
- [ ] GCP Cloud Run deployment automation
- [ ] PostgreSQL/Cloud Storage for production
- [ ] Game replay/history
- [ ] Elo rating system
- [ ] Sensei's Path expansion (16 additional cards)
- [ ] User profiles with avatars
- [ ] Game chat

## License

This is a fan implementation for educational purposes. Onitama is designed by Shimpei Sato and published by Arcane Wonders.

## Contributing

Feel free to open issues or submit pull requests!
