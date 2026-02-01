import { io, Socket } from 'socket.io-client';

export interface SocketEvents {
  // Lobby events
  'lobby:waiting': () => void;
  'lobby:matched': (data: MatchedData) => void;
  'lobby:left': () => void;
  
  // Game events
  'game:state': (data: { gameState: any }) => void;
  'game:error': (data: { error: string }) => void;
  'game:opponent_disconnected': (data: { gameId: string; username: string }) => void;
}

export interface MatchedData {
  gameId: string;
  playerNumber: 1 | 2;
  opponentUsername: string;
  gameState: any;
}

let socket: Socket | null = null;

/**
 * Initialize Socket.IO connection with authentication
 * @param token - JWT authentication token
 * @returns Socket instance
 */
export function initializeSocket(token: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const socketUrl = import.meta.env.PROD 
    ? window.location.origin 
    : 'http://localhost:3000';

  socket = io(socketUrl, {
    auth: {
      token
    },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
  });

  return socket;
}

/**
 * Get current socket instance
 * @returns Socket instance or null
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnect socket
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Join matchmaking lobby
 */
export function joinLobby(): void {
  if (!socket) {
    throw new Error('Socket not initialized');
  }
  socket.emit('lobby:join');
}

/**
 * Leave matchmaking lobby
 */
export function leaveLobby(): void {
  if (!socket) {
    throw new Error('Socket not initialized');
  }
  socket.emit('lobby:leave');
}

/**
 * Make a move in a PvP game
 * @param gameId - Game ID
 * @param pieceIndex - Index of the piece to move
 * @param toRow - Destination row
 * @param toCol - Destination column
 * @param cardName - Card to use for the move
 */
export function makeMove(
  gameId: string,
  pieceIndex: number,
  toRow: number,
  toCol: number,
  cardName: string
): void {
  if (!socket) {
    throw new Error('Socket not initialized');
  }
  socket.emit('game:move', { gameId, pieceIndex, toRow, toCol, cardName });
}
