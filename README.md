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
- File-based data persistence
- Rate limiting for API protection

**DevOps:**
- Docker containerization
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
- `make prod-deploy` - TODO: Deploy to GCP Cloud Run

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

## Data Persistence

The application uses file-based storage in the `data/` directory:
- `data/users.json` - User accounts and authentication
- `data/games.json` - Active and completed games
- `data/leaderboard.json` - Player statistics

In production, consider migrating to a proper database (PostgreSQL, MongoDB, etc.).

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
