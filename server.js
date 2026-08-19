import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8081;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bingo WebSocket Server Running');
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

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoomState(room) {
  const calledSet = new Set(room.calledNumbers);
  const p1Lines = getCompletedLineIndices(room.player1Card, calledSet).length;
  const p2Lines = getCompletedLineIndices(room.player2Card, calledSet).length;

  const baseState = {
    type: 'game_state',
    roomId: room.roomId,
    calledNumbers: room.calledNumbers,
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
      player1Card: room.player1Card,
      player2Card: room.player2Card,
      player1Lines: p1Lines,
      player2Lines: p2Lines,
    };

    if (room.player1?.ws) {
      send(room.player1.ws, {
        ...fullRevealState,
        playerNum: 1,
        myCard: room.player1Card,
        opponentConnected: !!room.player2?.ws,
        resetRequestedByOpponent: room.resetRequests.has(2),
        myResetRequested: room.resetRequests.has(1),
      });
    }

    if (room.player2?.ws) {
      send(room.player2.ws, {
        ...fullRevealState,
        playerNum: 2,
        myCard: room.player2Card,
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
        myCard: room.player1Card,
        myLines: p1Lines,
        opponentConnected: !!room.player2?.ws,
        resetRequestedByOpponent: room.resetRequests.has(2),
        myResetRequested: room.resetRequests.has(1),
      });
    }

    if (room.player2?.ws) {
      send(room.player2.ws, {
        ...baseState,
        playerNum: 2,
        myCard: room.player2Card,
        myLines: p2Lines,
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

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'create_room') {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) {
          roomId = generateRoomId();
        }

        const room = {
          roomId,
          player1: { ws, id: data.playerId || 'p1' },
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
        };

        rooms.set(roomId, room);
        currentRoomId = roomId;
        currentPlayerNum = 1;

        send(ws, {
          type: 'room_created',
          roomId,
          playerNum: 1,
          playerCount: 1,
          myCard: room.player1Card,
        });
        return;
      }

      if (data.type === 'join_room') {
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

        if (!room.player1) {
          room.player1 = { ws, id: data.playerId || 'p1' };
          currentPlayerNum = 1;
        } else {
          room.player2 = { ws, id: data.playerId || 'p2' };
          currentPlayerNum = 2;
        }

        currentRoomId = roomId;

        if (room.player1 && room.player2) {
          room.gameStatus = 'in_progress';
        }

        broadcastRoomState(room);
        return;
      }

      if (data.type === 'make_move') {
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
        } else {
          room.currentTurn = room.currentTurn === 1 ? 2 : 1;
        }

        broadcastRoomState(room);
        return;
      }

      if (data.type === 'request_new_game') {
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
        }

        broadcastRoomState(room);
        return;
      }

      if (data.type === 'leave_room') {
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
    } catch {
      send(ws, { type: 'error', message: 'Internal error processing message.' });
    }
  });

  ws.on('close', () => {
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
        if (!room.gameOver) {
          room.gameStatus = 'opponent_disconnected';
        }
        broadcastRoomState(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
