const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({
  port: PORT
});

console.log(`WebSocket server running on port ${PORT}`);

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

function countCompletedLines(card, calledSet) {
  if (!card || card.length !== 25) return 0;
  let count = 0;
  for (const lineCells of LINE_DEFS) {
    let full = true;
    for (const cellIdx of lineCells) {
      if (!calledSet.has(card[cellIdx])) {
        full = false;
        break;
      }
    }
    if (full) count++;
  }
  return count;
}

function resolveGameResult(p1Lines, p2Lines, totalCalled) {
  if (p1Lines >= 5 && p2Lines >= 5) return "draw";
  if (p1Lines >= 5) return "player1";
  if (p2Lines >= 5) return "player2";
  if (totalCalled >= 25) return "draw";
  return null;
}

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

const rooms = new Map();
const ROOM_CLEANUP_DELAY = 60 * 1000;

function scheduleRoomCleanup(roomId) {
  setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room) return;
    const p1Active = room.player1 && room.player1.ws && room.player1.ws.readyState === WebSocket.OPEN;
    const p2Active = room.player2 && room.player2.ws && room.player2.ws.readyState === WebSocket.OPEN;
    if (!p1Active && !p2Active) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} cleaned up`);
    }
  }, ROOM_CLEANUP_DELAY);
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error("Error sending message to client:", e.message);
    }
  }
}

function broadcastGameState(room) {
  const calledSet = new Set(room.calledNumbers);
  const p1Lines = countCompletedLines(room.player1Card, calledSet);
  const p2Lines = countCompletedLines(room.player2Card, calledSet);

  const sharedState = {
    type: "game_state",
    roomId: room.roomId,
    calledNumbers: [...room.calledNumbers],
    lastCalledNumber: room.lastCalledNumber,
    currentTurn: room.currentTurn,
    gameStatus: room.gameStatus,
    gameOver: room.gameOver,
    winner: room.winner,
    playerCount: (room.player1 ? 1 : 0) + (room.player2 ? 1 : 0),
    resetRequestedBy: Array.from(room.resetRequests),
  };

  // Player 1 message - strictly private card
  if (room.player1 && room.player1.ws) {
    const p1Msg = {
      ...sharedState,
      playerNum: 1,
      playerId: "player1",
      ownCard: room.player1Card,
      myCard: room.player1Card,
      myLines: p1Lines,
      opponentConnected: !!(room.player2 && room.player2.ws && room.player2.ws.readyState === WebSocket.OPEN),
      myResetRequested: room.resetRequests.has(1),
      resetRequestedByOpponent: room.resetRequests.has(2),
    };
    if (room.gameOver) {
      p1Msg.opponentCard = room.player2Card;
      p1Msg.player1Card = room.player1Card;
      p1Msg.player2Card = room.player2Card;
      p1Msg.player1Lines = p1Lines;
      p1Msg.player2Lines = p2Lines;
    }
    send(room.player1.ws, p1Msg);
  }

  // Player 2 message - strictly private card
  if (room.player2 && room.player2.ws) {
    const p2Msg = {
      ...sharedState,
      playerNum: 2,
      playerId: "player2",
      ownCard: room.player2Card,
      myCard: room.player2Card,
      myLines: p2Lines,
      opponentConnected: !!(room.player1 && room.player1.ws && room.player1.ws.readyState === WebSocket.OPEN),
      myResetRequested: room.resetRequests.has(2),
      resetRequestedByOpponent: room.resetRequests.has(1),
    };
    if (room.gameOver) {
      p2Msg.opponentCard = room.player1Card;
      p2Msg.player1Card = room.player1Card;
      p2Msg.player2Card = room.player2Card;
      p2Msg.player1Lines = p1Lines;
      p2Msg.player2Lines = p2Lines;
    }
    send(room.player2.ws, p2Msg);
  }
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  let currentRoomId = null;
  let currentPlayerNum = null;
  let currentPlayerId = null;

  // Send initial connected confirmation
  send(ws, { type: "connected", message: "Connected to Bingo WebSocket server" });

  ws.on("message", (rawMessage) => {
    let messageStr = rawMessage.toString();
    console.log("Received:", messageStr);

    let data;
    try {
      data = JSON.parse(messageStr);
    } catch (e) {
      send(ws, { type: "error", message: "Invalid message format." });
      return;
    }

    try {
      const type = (data.type || "").toLowerCase();

      if (type === "create_room") {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();

        const playerId = data.playerId || ("p1_" + Math.random().toString(36).substring(2, 9));
        currentPlayerId = playerId;

        const room = {
          roomId,
          player1: { ws, id: playerId },
          player2: null,
          player1Card: createShuffledCard(),
          player2Card: createShuffledCard(),
          calledNumbers: [],
          lastCalledNumber: null,
          currentTurn: 1,
          gameStatus: "waiting",
          gameOver: false,
          winner: null,
          resetRequests: new Set(),
        };

        rooms.set(roomId, room);
        currentRoomId = roomId;
        currentPlayerNum = 1;

        console.log(`Room created: ${roomId} by player ${playerId}`);

        send(ws, {
          type: "room_created",
          roomId,
          playerNum: 1,
          playerId: "player1",
          playerCount: 1,
          myCard: room.player1Card,
          ownCard: room.player1Card,
          gameStatus: "waiting",
        });
        return;
      }

      if (type === "join_room") {
        const roomId = (data.roomId || "").trim().toUpperCase();
        const room = rooms.get(roomId);

        if (!room) {
          send(ws, { type: "error", message: "GAME NOT FOUND" });
          return;
        }

        if (room.gameStatus !== "waiting") {
          // Check for reconnect
          if (data.playerId && room.player1 && room.player1.id === data.playerId) {
            room.player1.ws = ws;
            currentRoomId = roomId;
            currentPlayerNum = 1;
            currentPlayerId = data.playerId;
            broadcastGameState(room);
            return;
          }
          if (data.playerId && room.player2 && room.player2.id === data.playerId) {
            room.player2.ws = ws;
            currentRoomId = roomId;
            currentPlayerNum = 2;
            currentPlayerId = data.playerId;
            broadcastGameState(room);
            return;
          }
          send(ws, { type: "error", message: "GAME IS FULL" });
          return;
        }

        if (room.player1 && room.player2) {
          send(ws, { type: "error", message: "GAME IS FULL" });
          return;
        }

        const playerId = data.playerId || ("p2_" + Math.random().toString(36).substring(2, 9));
        currentPlayerId = playerId;

        room.player2 = { ws, id: playerId };
        room.gameStatus = "in_progress";
        currentRoomId = roomId;
        currentPlayerNum = 2;

        console.log(`Player ${playerId} joined room ${roomId}. Starting game.`);

        send(ws, {
          type: "room_joined",
          roomId,
          playerNum: 2,
          playerId: "player2",
          myCard: room.player2Card,
          ownCard: room.player2Card,
          gameStatus: "in_progress",
        });

        if (room.player1 && room.player1.ws) {
          send(room.player1.ws, {
            type: "game_started",
            roomId,
            playerCount: 2,
          });
        }

        send(ws, {
          type: "game_started",
          roomId,
          playerCount: 2,
        });

        broadcastGameState(room);
        return;
      }

      if (type === "reconnect") {
        const roomId = (data.roomId || "").trim().toUpperCase();
        const playerId = data.playerId;
        const room = rooms.get(roomId);

        if (!room || !playerId) {
          send(ws, { type: "error", message: "Cannot reconnect. Room not found." });
          return;
        }

        let reconnectedAs = null;
        if (room.player1 && room.player1.id === playerId) {
          room.player1.ws = ws;
          reconnectedAs = 1;
        } else if (room.player2 && room.player2.id === playerId) {
          room.player2.ws = ws;
          reconnectedAs = 2;
        }

        if (!reconnectedAs) {
          send(ws, { type: "error", message: "Cannot reconnect. Player not found in room." });
          return;
        }

        currentRoomId = roomId;
        currentPlayerNum = reconnectedAs;
        currentPlayerId = playerId;

        console.log(`Player ${playerId} reconnected to room ${roomId} as Player ${reconnectedAs}`);

        if (room.gameStatus === "opponent_disconnected") {
          const opponentActive =
            reconnectedAs === 1
              ? room.player2 && room.player2.ws && room.player2.ws.readyState === WebSocket.OPEN
              : room.player1 && room.player1.ws && room.player1.ws.readyState === WebSocket.OPEN;

          if (opponentActive && !room.gameOver) {
            room.gameStatus = "in_progress";
          }
        }

        broadcastGameState(room);
        return;
      }

      if (type === "select_number" || type === "make_move") {
        if (!currentRoomId || !currentPlayerNum) {
          send(ws, { type: "invalid_move", message: "INVALID MOVE" });
          return;
        }
        const room = rooms.get(currentRoomId);
        if (!room) {
          send(ws, { type: "invalid_move", message: "GAME NOT FOUND" });
          return;
        }

        if (room.gameOver) {
          send(ws, { type: "invalid_move", message: "GAME OVER" });
          return;
        }

        if (room.gameStatus !== "in_progress") {
          send(ws, { type: "invalid_move", message: "INVALID MOVE" });
          return;
        }

        if (room.currentTurn !== currentPlayerNum) {
          send(ws, { type: "invalid_move", message: "NOT YOUR TURN" });
          return;
        }

        const number = parseInt(data.number, 10);
        if (isNaN(number) || number < 1 || number > 25) {
          send(ws, { type: "invalid_move", message: "INVALID NUMBER" });
          return;
        }

        if (room.calledNumbers.includes(number)) {
          send(ws, { type: "invalid_move", message: "NUMBER ALREADY CALLED" });
          return;
        }

        const playerCard = currentPlayerNum === 1 ? room.player1Card : room.player2Card;
        if (!playerCard.includes(number)) {
          send(ws, { type: "invalid_move", message: "INVALID NUMBER" });
          return;
        }

        room.calledNumbers.push(number);
        room.lastCalledNumber = number;

        console.log(`Room ${currentRoomId}: Player ${currentPlayerNum} selected ${number}`);

        const calledSet = new Set(room.calledNumbers);
        const p1Lines = countCompletedLines(room.player1Card, calledSet);
        const p2Lines = countCompletedLines(room.player2Card, calledSet);
        const result = resolveGameResult(p1Lines, p2Lines, room.calledNumbers.length);

        if (result !== null) {
          room.gameOver = true;
          room.gameStatus = "game_over";
          room.winner = result;
          console.log(`Room ${currentRoomId} Game Over! Winner: ${result}`);
        } else {
          room.currentTurn = room.currentTurn === 1 ? 2 : 1;
        }

        broadcastGameState(room);
        return;
      }

      if (type === "request_restart" || type === "request_new_game") {
        if (!currentRoomId || !currentPlayerNum) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        room.resetRequests.add(currentPlayerNum);

        const oppNum = currentPlayerNum === 1 ? 2 : 1;
        const oppWs = oppNum === 1 ? room.player1?.ws : room.player2?.ws;
        if (oppWs) {
          send(oppWs, {
            type: "restart_request",
            requestedBy: `player${currentPlayerNum}`,
            message: `PLAYER ${currentPlayerNum} WANTS TO START A NEW GAME`
          });
        }

        if (room.resetRequests.has(1) && room.resetRequests.has(2)) {
          room.player1Card = createShuffledCard();
          room.player2Card = createShuffledCard();
          room.calledNumbers = [];
          room.lastCalledNumber = null;
          room.currentTurn = 1;
          room.gameStatus = "in_progress";
          room.gameOver = false;
          room.winner = null;
          room.resetRequests.clear();

          console.log(`Room ${currentRoomId} restarted with new cards`);

          if (room.player1?.ws) send(room.player1.ws, { type: "restart_accepted" });
          if (room.player2?.ws) send(room.player2.ws, { type: "restart_accepted" });
        }

        broadcastGameState(room);
        return;
      }

      if (type === "restart_response" || type === "response_restart") {
        if (!currentRoomId || !currentPlayerNum) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        if (data.accept) {
          room.resetRequests.add(currentPlayerNum);
          if (room.resetRequests.has(1) && room.resetRequests.has(2)) {
            room.player1Card = createShuffledCard();
            room.player2Card = createShuffledCard();
            room.calledNumbers = [];
            room.lastCalledNumber = null;
            room.currentTurn = 1;
            room.gameStatus = "in_progress";
            room.gameOver = false;
            room.winner = null;
            room.resetRequests.clear();

            if (room.player1?.ws) send(room.player1.ws, { type: "restart_accepted" });
            if (room.player2?.ws) send(room.player2.ws, { type: "restart_accepted" });
          }
        } else {
          room.resetRequests.clear();
          const oppNum = currentPlayerNum === 1 ? 2 : 1;
          const oppWs = oppNum === 1 ? room.player1?.ws : room.player2?.ws;
          if (oppWs) {
            send(oppWs, { type: "restart_declined", message: "Opponent declined new game request." });
          }
        }

        broadcastGameState(room);
        return;
      }

      if (type === "leave_room") {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
          console.log(`Player ${currentPlayerNum} left room ${currentRoomId}`);
          if (currentPlayerNum === 1) {
            room.player1 = null;
          } else if (currentPlayerNum === 2) {
            room.player2 = null;
          }

          const anyLeft = room.player1 || room.player2;
          if (!anyLeft) {
            rooms.delete(currentRoomId);
            console.log(`Room ${currentRoomId} deleted (empty)`);
          } else {
            room.gameStatus = "opponent_disconnected";
            broadcastGameState(room);
            scheduleRoomCleanup(currentRoomId);
          }
        }
        currentRoomId = null;
        currentPlayerNum = null;
        currentPlayerId = null;
        return;
      }
    } catch (err) {
      console.error("Server error handling message:", err);
      send(ws, { type: "error", message: "Server error processing your request." });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (currentPlayerNum === 1 && room.player1) {
      room.player1 = { id: currentPlayerId, ws: null };
    } else if (currentPlayerNum === 2 && room.player2) {
      room.player2 = { id: currentPlayerId, ws: null };
    }

    const p1HasWs = room.player1 && room.player1.ws && room.player1.ws.readyState === WebSocket.OPEN;
    const p2HasWs = room.player2 && room.player2.ws && room.player2.ws.readyState === WebSocket.OPEN;

    if (!p1HasWs && !p2HasWs) {
      scheduleRoomCleanup(currentRoomId);
    } else {
      if (!room.gameOver) {
        room.gameStatus = "opponent_disconnected";
      }
      broadcastGameState(room);
      scheduleRoomCleanup(currentRoomId);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket client error:", err.message);
  });
});
