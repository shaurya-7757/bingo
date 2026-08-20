const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({
  port: PORT,
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
const connectedUsers = new Map();

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
    player1Username: room.player1?.username || "Player 1",
    player2Username: room.player2?.username || "Player 2",
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
      ownCard: [...room.player1Card],
      myCard: [...room.player1Card],
      myLines: p1Lines,
      opponentUsername: room.player2?.username || "Player 2",
      opponentConnected: !!(room.player2 && room.player2.ws && room.player2.ws.readyState === WebSocket.OPEN),
      myResetRequested: room.resetRequests.has(1),
      resetRequestedByOpponent: room.resetRequests.has(2),
    };
    if (room.gameOver) {
      p1Msg.opponentCard = [...room.player2Card];
      p1Msg.player1Card = [...room.player1Card];
      p1Msg.player2Card = [...room.player2Card];
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
      ownCard: [...room.player2Card],
      myCard: [...room.player2Card],
      myLines: p2Lines,
      opponentUsername: room.player1?.username || "Player 1",
      opponentConnected: !!(room.player1 && room.player1.ws && room.player1.ws.readyState === WebSocket.OPEN),
      myResetRequested: room.resetRequests.has(2),
      resetRequestedByOpponent: room.resetRequests.has(1),
    };
    if (room.gameOver) {
      p2Msg.opponentCard = [...room.player1Card];
      p2Msg.player1Card = [...room.player1Card];
      p2Msg.player2Card = [...room.player2Card];
      p2Msg.player1Lines = p1Lines;
      p2Msg.player2Lines = p2Lines;
    }
    send(room.player2.ws, p2Msg);
  }
}

wss.on("connection", (ws) => {
  let currentRoomId = null;
  let currentPlayerNum = null;
  let currentUserId = null;

  send(ws, { type: "connected", message: "Connected to Bingo WebSocket server" });

  ws.on("message", (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage.toString());
    } catch (e) {
      send(ws, { type: "error", message: "Invalid message format." });
      return;
    }

    try {
      const type = (data.type || "").toLowerCase();

      if (type === "register_user") {
        if (data.userId) {
          currentUserId = data.userId;
          connectedUsers.set(data.userId, { ws, username: data.username || "Player" });
        }
        return;
      }

      // Friend Game Invitation Relay & Management
      if (type === "friend_invite" || type === "invite_friend") {
        const target = connectedUsers.get(data.targetUserId);
        if (!target || target.ws.readyState !== WebSocket.OPEN) {
          send(ws, {
            type: "invitation_error",
            message: `${data.targetUsername || "Friend"} is currently offline.`,
          });
          return;
        }

        // Check if target is already in an active game
        let inGame = false;
        for (const r of rooms.values()) {
          if (
            (r.player1?.id === data.targetUserId || r.player2?.id === data.targetUserId) &&
            r.gameStatus === "in_progress"
          ) {
            inGame = true;
            break;
          }
        }

        if (inGame) {
          send(ws, {
            type: "invitation_error",
            message: `${data.targetUsername || "Friend"} is currently in a game.`,
          });
          return;
        }

        const invitationId = "inv_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const expiresAt = new Date(Date.now() + 90000).toISOString();

        send(target.ws, {
          type: "friend_invite_received",
          invitationId,
          inviterId: data.inviterId,
          inviterUsername: data.inviterUsername || "A friend",
          roomId: data.roomId,
          expiresAt,
        });

        send(ws, {
          type: "invitation_sent",
          invitationId,
          roomId: data.roomId,
          targetUserId: data.targetUserId,
          targetUsername: data.targetUsername,
          expiresAt,
        });
        return;
      }

      if (type === "accept_invite" || type === "accept_game_invitation") {
        const inviter = connectedUsers.get(data.inviterId);
        if (inviter && inviter.ws.readyState === WebSocket.OPEN) {
          send(inviter.ws, {
            type: "invitation_accepted",
            roomId: data.roomId,
            respondentUsername: data.username || data.respondentUsername || "Friend",
          });
        }
        return;
      }

      if (type === "deny_invite" || type === "deny_game_invitation") {
        const inviter = connectedUsers.get(data.inviterId);
        if (inviter && inviter.ws.readyState === WebSocket.OPEN) {
          send(inviter.ws, {
            type: "invitation_declined",
            roomId: data.roomId,
            respondentUsername: data.username || data.respondentUsername || "Friend",
          });
        }
        if (data.roomId && rooms.has(data.roomId)) {
          const room = rooms.get(data.roomId);
          if (room && !room.player2 && room.gameStatus === "waiting") {
            rooms.delete(data.roomId);
          }
        }
        return;
      }

      if (type === "cancel_invite" || type === "cancel_game_invitation") {
        if (data.targetUserId) {
          const target = connectedUsers.get(data.targetUserId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            send(target.ws, {
              type: "invitation_cancelled",
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

      if (type === "create_room") {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();

        const room = {
          roomId,
          player1: {
            ws,
            id: data.playerId || "p1",
            username: data.username || "Player 1",
          },
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
          startedAt: new Date().toISOString(),
        };

        rooms.set(roomId, room);
        currentRoomId = roomId;
        currentPlayerNum = 1;

        send(ws, {
          type: "room_created",
          roomId,
          playerNum: 1,
          playerId: "player1",
          playerCount: 1,
          myCard: [...room.player1Card],
          player1Username: room.player1.username,
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

        if (room.player1 && room.player2) {
          if (data.playerId && (room.player1.id === data.playerId || room.player2.id === data.playerId)) {
            const isP1 = room.player1.id === data.playerId;
            if (isP1) room.player1.ws = ws;
            else room.player2.ws = ws;
            currentRoomId = roomId;
            currentPlayerNum = isP1 ? 1 : 2;
            broadcastGameState(room);
            return;
          }
          send(ws, { type: "error", message: "GAME IS FULL" });
          return;
        }

        const playerInfo = {
          ws,
          id: data.playerId || "p2",
          username: data.username || "Player 2",
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
          room.gameStatus = "in_progress";
          send(room.player1.ws, { type: "game_started" });
          send(room.player2.ws, { type: "game_started" });
        }

        broadcastGameState(room);
        return;
      }

      if (type === "select_number" || type === "make_move") {
        if (!currentRoomId || !currentPlayerNum) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        if (room.gameOver || room.gameStatus !== "in_progress") return;
        if (room.currentTurn !== currentPlayerNum) return;

        const number = parseInt(data.number, 10);
        if (isNaN(number) || number < 1 || number > 25) return;
        if (room.calledNumbers.includes(number)) return;

        const playerCard = currentPlayerNum === 1 ? room.player1Card : room.player2Card;
        if (!playerCard.includes(number)) return;

        room.calledNumbers.push(number);
        room.lastCalledNumber = number;

        const calledSet = new Set(room.calledNumbers);
        const p1Lines = countCompletedLines(room.player1Card, calledSet);
        const p2Lines = countCompletedLines(room.player2Card, calledSet);
        const result = resolveGameResult(p1Lines, p2Lines, room.calledNumbers.length);

        if (result !== null) {
          room.gameOver = true;
          room.gameStatus = "game_over";
          room.winner = result;
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
          room.startedAt = new Date().toISOString();
        }

        broadcastGameState(room);
        return;
      }

      if (type === "leave_room") {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
          if (currentPlayerNum === 1) room.player1 = null;
          else if (currentPlayerNum === 2) room.player2 = null;

          if (!room.player1 && !room.player2) {
            rooms.delete(currentRoomId);
          } else {
            room.gameStatus = "opponent_disconnected";
            broadcastGameState(room);
          }
        }
        currentRoomId = null;
        currentPlayerNum = null;
        return;
      }
    } catch (e) {
      console.error("Error processing message:", e.message);
    }
  });

  ws.on("close", () => {
    if (currentUserId) connectedUsers.delete(currentUserId);
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        if (currentPlayerNum === 1 && room.player1?.ws === ws) room.player1.ws = null;
        else if (currentPlayerNum === 2 && room.player2?.ws === ws) room.player2.ws = null;

        if ((!room.player1 || !room.player1.ws) && (!room.player2 || !room.player2.ws)) {
          rooms.delete(currentRoomId);
        } else {
          room.gameStatus = "opponent_disconnected";
          broadcastGameState(room);
        }
      }
    }
  });
});
