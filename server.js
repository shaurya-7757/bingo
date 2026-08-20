import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bingo WebSocket & Realtime Server Running');
});

const wss = new WebSocketServer({ server });

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function createShuffledCard() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  return shuffleArray(numbers);
}

function getLineDefinitions() {
  const lines = [];
  for (let row = 0; row < 5; row++) {
    const line = [];
    for (let col = 0; col < 5; col++) line.push(row * 5 + col);
    lines.push(line);
  }
  for (let col = 0; col < 5; col++) {
    const line = [];
    for (let row = 0; row < 5; row++) line.push(row * 5 + col);
    lines.push(line);
  }
  const diag1 = [];
  for (let i = 0; i < 5; i++) diag1.push(i * 5 + i);
  lines.push(diag1);
  const diag2 = [];
  for (let i = 0; i < 5; i++) diag2.push(i * 5 + (4 - i));
  lines.push(diag2);
  return lines;
}

const LINE_DEFS = getLineDefinitions();

function getCompletedLineIndices(card, calledSet) {
  const completed = [];
  for (let lineIdx = 0; lineIdx < LINE_DEFS.length; lineIdx++) {
    const cells = LINE_DEFS[lineIdx];
    let full = true;
    for (const cellIdx of cells) {
      if (!calledSet.has(card[cellIdx])) {
        full = false;
        break;
      }
    }
    if (full) completed.push(lineIdx);
  }
  return completed;
}

function resolveGameResult(p1Lines, p2Lines, totalCalled) {
  if (p1Lines >= 5 && p2Lines >= 5) return 'draw';
  if (p1Lines >= 5) return 'player1';
  if (p2Lines >= 5) return 'player2';
  if (totalCalled >= 25) return 'draw';
  return null;
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

const rooms = new Map();
const connectedUsers = new Map(); // userId -> { ws, username }

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error('Error sending WS message:', e.message);
    }
  }
}

async function saveMatchRecord(room) {
  if (!supabase) return;
  try {
    const p1Id = room.player1?.id && !room.player1.id.startsWith('guest_') ? room.player1.id : null;
    const p2Id = room.player2?.id && !room.player2.id.startsWith('guest_') ? room.player2.id : null;
    const winnerId = room.winner === 'player1' ? p1Id : room.winner === 'player2' ? p2Id : null;

    const calledSet = new Set(room.calledNumbers);
    const p1Lines = getCompletedLineIndices(room.player1Card, calledSet).length;
    const p2Lines = getCompletedLineIndices(room.player2Card, calledSet).length;

    await supabase.from('online_matches').insert({
      room_id: room.roomId,
      player1_id: p1Id,
      player2_id: p2Id,
      player1_username: room.player1?.username || 'Player 1',
      player2_username: room.player2?.username || 'Player 2',
      winner_id: winnerId,
      result: room.winner,
      player1_lines: p1Lines,
      player2_lines: p2Lines,
      called_numbers: room.calledNumbers,
      last_called_number: room.lastCalledNumber,
      total_called: room.calledNumbers.length,
      started_at: room.startedAt,
      ended_at: new Date().toISOString(),
    });
    console.log(`Match ${room.roomId} saved to Supabase.`);
  } catch (err) {
    console.warn('Error saving match record to Supabase:', err.message);
  }
}

function broadcastRoomState(room) {
  const calledSet = new Set(room.calledNumbers);
  const p1Lines = getCompletedLineIndices(room.player1Card, calledSet).length;
  const p2Lines = getCompletedLineIndices(room.player2Card, calledSet).length;

  const baseState = {
    type: 'game_state',
    roomId: room.roomId,
    player1Username: room.player1?.username || 'Player 1',
    player2Username: room.player2?.username || 'Player 2',
    calledNumbers: [...room.calledNumbers],
    lastCalledNumber: room.lastCalledNumber,
    currentTurn: room.currentTurn,
    gameStatus: room.gameStatus,
    gameOver: room.gameOver,
    winner: room.winner,
    playerCount: (room.player1 ? 1 : 0) + (room.player2 ? 1 : 0),
  };

  if (room.gameOver) {
    const fullRevealState = {
      ...baseState,
      player1Card: [...room.player1Card],
      player2Card: [...room.player2Card],
      player1Lines: p1Lines,
      player2Lines: p2Lines,
    };

    if (room.player1?.ws) {
      send(room.player1.ws, {
        ...fullRevealState,
        playerNum: 1,
        playerId: 'player1',
        myCard: [...room.player1Card],
        opponentCard: [...room.player2Card],
        opponentUsername: room.player2?.username || 'Player 2',
        opponentConnected: !!room.player2?.ws,
        resetRequestedByOpponent: room.resetRequests.has(2),
        myResetRequested: room.resetRequests.has(1),
      });
    }

    if (room.player2?.ws) {
      send(room.player2.ws, {
        ...fullRevealState,
        playerNum: 2,
        playerId: 'player2',
        myCard: [...room.player2Card],
        opponentCard: [...room.player1Card],
        opponentUsername: room.player1?.username || 'Player 1',
        opponentConnected: !!room.player1?.ws,
        resetRequestedByOpponent: room.resetRequests.has(1),
        myResetRequested: room.resetRequests.has(2),
      });
    }
  } else {
    if (room.player1?.ws) {
      send(room.player1.ws, {
        ...baseState,
        playerNum: 1,
        playerId: 'player1',
        myCard: [...room.player1Card],
        myLines: p1Lines,
        opponentUsername: room.player2?.username || 'Player 2',
        opponentConnected: !!room.player2?.ws,
        resetRequestedByOpponent: room.resetRequests.has(2),
        myResetRequested: room.resetRequests.has(1),
      });
    }

    if (room.player2?.ws) {
      send(room.player2.ws, {
        ...baseState,
        playerNum: 2,
        playerId: 'player2',
        myCard: [...room.player2Card],
        myLines: p2Lines,
        opponentUsername: room.player1?.username || 'Player 1',
        opponentConnected: !!room.player1?.ws,
        resetRequestedByOpponent: room.resetRequests.has(1),
        myResetRequested: room.resetRequests.has(2),
      });
    }
  }
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerNum = null;
  let currentUserId = null;

  send(ws, { type: 'connected', message: 'Connected to Bingo WebSocket server' });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      const type = (data.type || '').toLowerCase();

      // Register presence for friend invitations & status
      if (type === 'register_user') {
        if (data.userId) {
          currentUserId = data.userId;
          connectedUsers.set(data.userId, { ws, username: data.username || 'Player' });
        }
        return;
      }

      // Friend Game Invitation Relay & Management
      if (type === 'friend_invite' || type === 'invite_friend') {
        const target = connectedUsers.get(data.targetUserId);
        if (!target || target.ws.readyState !== WebSocket.OPEN) {
          send(ws, {
            type: 'invitation_error',
            message: `${data.targetUsername || 'Friend'} is currently offline.`,
          });
          return;
        }

        // Check if target is already in an active game
        let inGame = false;
        for (const r of rooms.values()) {
          if (
            (r.player1?.id === data.targetUserId || r.player2?.id === data.targetUserId) &&
            r.gameStatus === 'in_progress'
          ) {
            inGame = true;
            break;
          }
        }

        if (inGame) {
          send(ws, {
            type: 'invitation_error',
            message: `${data.targetUsername || 'Friend'} is currently in a game.`,
          });
          return;
        }

        const invitationId = 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const expiresAt = new Date(Date.now() + 90000).toISOString();

        send(target.ws, {
          type: 'friend_invite_received',
          invitationId,
          inviterId: data.inviterId,
          inviterUsername: data.inviterUsername || 'A friend',
          roomId: data.roomId,
          expiresAt,
        });

        send(ws, {
          type: 'invitation_sent',
          invitationId,
          roomId: data.roomId,
          targetUserId: data.targetUserId,
          targetUsername: data.targetUsername,
          expiresAt,
        });
        return;
      }

      if (type === 'accept_invite' || type === 'accept_game_invitation') {
        const inviter = connectedUsers.get(data.inviterId);
        if (inviter && inviter.ws.readyState === WebSocket.OPEN) {
          send(inviter.ws, {
            type: 'invitation_accepted',
            roomId: data.roomId,
            respondentUsername: data.username || data.respondentUsername || 'Friend',
          });
        }
        return;
      }

      if (type === 'deny_invite' || type === 'deny_game_invitation') {
        const inviter = connectedUsers.get(data.inviterId);
        if (inviter && inviter.ws.readyState === WebSocket.OPEN) {
          send(inviter.ws, {
            type: 'invitation_declined',
            roomId: data.roomId,
            respondentUsername: data.username || data.respondentUsername || 'Friend',
          });
        }
        // If room is empty or only has host waiting, close room
        if (data.roomId && rooms.has(data.roomId)) {
          const room = rooms.get(data.roomId);
          if (room && !room.player2 && room.gameStatus === 'waiting') {
            rooms.delete(data.roomId);
          }
        }
        return;
      }

      if (type === 'cancel_invite' || type === 'cancel_game_invitation') {
        if (data.targetUserId) {
          const target = connectedUsers.get(data.targetUserId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            send(target.ws, {
              type: 'invitation_cancelled',
              roomId: data.roomId,
              inviterUsername: data.inviterUsername,
            });
          }
        }
        if (data.roomId && rooms.has(data.roomId)) {
          rooms.delete(data.roomId);
        }
        return;
      }

      if (type === 'create_room') {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) {
          roomId = generateRoomId();
        }

        const room = {
          roomId,
          player1: {
            ws,
            id: data.playerId || 'p1',
            username: data.username || 'Player 1',
          },
          player2: null,
          player1Card: createShuffledCard(),
          player2Card: createShuffledCard(),
          calledNumbers: [],
          lastCalledNumber: null,
          currentTurn: 1,
          gameStatus: 'waiting',
          gameOver: false,
          winner: null,
          resetRequests: new Set(),
          startedAt: new Date().toISOString(),
        };

        rooms.set(roomId, room);
        currentRoomId = roomId;
        currentPlayerNum = 1;

        send(ws, {
          type: 'room_created',
          roomId,
          playerNum: 1,
          playerId: 'player1',
          playerCount: 1,
          myCard: [...room.player1Card],
          player1Username: room.player1.username,
        });
        return;
      }

      if (type === 'join_room') {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);

        if (!room) {
          send(ws, { type: 'error', message: 'Game not found.' });
          return;
        }

        if (room.player1 && room.player2) {
          if (data.playerId && (room.player1.id === data.playerId || room.player2.id === data.playerId)) {
            const isP1 = room.player1.id === data.playerId;
            const pNum = isP1 ? 1 : 2;
            if (isP1) room.player1.ws = ws;
            else room.player2.ws = ws;
            currentRoomId = roomId;
            currentPlayerNum = pNum;
            broadcastRoomState(room);
            return;
          }
          send(ws, { type: 'error', message: 'Game is full.' });
          return;
        }

        const playerInfo = {
          ws,
          id: data.playerId || 'p2',
          username: data.username || 'Player 2',
        };

        if (!room.player1) {
          room.player1 = playerInfo;
          currentPlayerNum = 1;
        } else {
          room.player2 = playerInfo;
          currentPlayerNum = 2;
        }

        currentRoomId = roomId;

        if (room.player1 && room.player2) {
          room.gameStatus = 'in_progress';
          send(room.player1.ws, { type: 'game_started' });
          send(room.player2.ws, { type: 'game_started' });
        }

        broadcastRoomState(room);
        return;
      }

      if (type === 'select_number' || type === 'make_move') {
        if (!currentRoomId || !currentPlayerNum) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        if (room.gameOver || room.gameStatus !== 'in_progress') return;
        if (room.currentTurn !== currentPlayerNum) return;

        const number = parseInt(data.number, 10);
        if (isNaN(number) || number < 1 || number > 25) return;
        if (room.calledNumbers.includes(number)) return;

        const playerCard = currentPlayerNum === 1 ? room.player1Card : room.player2Card;
        if (!playerCard.includes(number)) return;

        room.calledNumbers.push(number);
        room.lastCalledNumber = number;

        const calledSet = new Set(room.calledNumbers);
        const p1Lines = getCompletedLineIndices(room.player1Card, calledSet).length;
        const p2Lines = getCompletedLineIndices(room.player2Card, calledSet).length;
        const result = resolveGameResult(p1Lines, p2Lines, room.calledNumbers.length);

        if (result !== null) {
          room.gameOver = true;
          room.gameStatus = 'game_over';
          room.winner = result;
          saveMatchRecord(room);
        } else {
          room.currentTurn = room.currentTurn === 1 ? 2 : 1;
        }

        broadcastRoomState(room);
        return;
      }

      if (type === 'request_restart' || type === 'request_new_game') {
        if (!currentRoomId || !currentPlayerNum) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        room.resetRequests.add(currentPlayerNum);

        if (room.resetRequests.has(1) && room.resetRequests.has(2)) {
          room.player1Card = createShuffledCard();
          room.player2Card = createShuffledCard();
          room.calledNumbers = [];
          room.lastCalledNumber = null;
          room.currentTurn = 1;
          room.gameStatus = 'in_progress';
          room.gameOver = false;
          room.winner = null;
          room.resetRequests.clear();
          room.startedAt = new Date().toISOString();
        }

        broadcastRoomState(room);
        return;
      }

      if (type === 'leave_room') {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
          if (currentPlayerNum === 1) {
            room.player1 = null;
          } else if (currentPlayerNum === 2) {
            room.player2 = null;
          }

          if (!room.player1 && !room.player2) {
            rooms.delete(currentRoomId);
          } else {
            room.gameStatus = 'opponent_disconnected';
            broadcastRoomState(room);
          }
        }
        currentRoomId = null;
        currentPlayerNum = null;
        return;
      }
    } catch (e) {
      console.error('Error handling message:', e.message);
    }
  });

  ws.on('close', () => {
    if (currentUserId) {
      connectedUsers.delete(currentUserId);
    }
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        if (currentPlayerNum === 1 && room.player1?.ws === ws) {
          room.player1.ws = null;
        } else if (currentPlayerNum === 2 && room.player2?.ws === ws) {
          room.player2.ws = null;
        }

        if ((!room.player1 || !room.player1.ws) && (!room.player2 || !room.player2.ws)) {
          rooms.delete(currentRoomId);
        } else {
          room.gameStatus = 'opponent_disconnected';
          broadcastRoomState(room);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bingo server running on port ${PORT}`);
});
