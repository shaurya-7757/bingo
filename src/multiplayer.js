import Peer from "peerjs";

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

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const PEER_PREFIX = "bingo-multiplayer-shaurya-";

/**
 * Universal Multiplayer Client
 * Supports both WebRTC Peer-to-Peer (100% Free, Zero Server Setup)
 * and optional custom WebSocket servers with automatic fallback.
 */
export class MultiplayerClient {
  constructor({ wsUrl, onMessage, onError, onStatusChange }) {
    this.wsUrl = wsUrl || null;
    this.onMessage = onMessage || (() => {});
    this.onError = onError || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this.mode = this.wsUrl ? "ws" : "p2p";
    this.ws = null;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    this.playerId = null;
    this.playerNum = 1;

    // Host room state (for p2p mode)
    this.hostState = null;
  }

  setWsUrl(url) {
    this.wsUrl = url ? url.trim() : null;
    this.mode = this.wsUrl ? "ws" : "p2p";
  }

  connect(onReady) {
    if (this.mode === "ws" && this.wsUrl) {
      this.connectWebSocket(onReady);
    } else {
      this.connectPeer(onReady);
    }
  }

  connectPeer(onReady) {
    this.mode = "p2p";
    this.onStatusChange("connected");
    if (onReady) onReady();
  }

  connectWebSocket(onReady) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.onStatusChange("connected");
      if (onReady) onReady();
      return;
    }

    this.onStatusChange("connecting");
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.warn("Failed to construct WebSocket, falling back to P2P:", err);
      this.fallbackToP2P(onReady);
      return;
    }

    const connectionTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket connection timed out. Falling back to P2P.");
        try { this.ws.close(); } catch {}
        this.fallbackToP2P(onReady);
      }
    }, 4000);

    this.ws.onopen = () => {
      clearTimeout(connectionTimer);
      this.onStatusChange("connected");
      if (onReady) onReady();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (err) {
        console.error("Malformed WS message:", event.data);
      }
    };

    this.ws.onerror = () => {
      clearTimeout(connectionTimer);
      console.warn("WebSocket unavailable. Switching to serverless P2P multiplayer.");
      this.fallbackToP2P(onReady);
    };

    this.ws.onclose = () => {
      clearTimeout(connectionTimer);
      if (this.mode === "ws") {
        this.onStatusChange("disconnected");
      }
    };
  }

  fallbackToP2P(onReady) {
    this.mode = "p2p";
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connectPeer(onReady);
  }

  createRoom(playerId) {
    this.playerId = playerId;

    if (this.mode === "ws" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "create_room", playerId }));
      return;
    }

    // WebRTC P2P Mode
    this.mode = "p2p";
    this.isHost = true;
    this.playerNum = 1;
    const roomCode = generateRoomCode();
    this.roomId = roomCode;
    const peerId = PEER_PREFIX + roomCode.toLowerCase();

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
    }

    try {
      this.peer = new Peer(peerId, {
        debug: 1,
      });
    } catch (err) {
      this.onError("Could not initialize multiplayer: " + err.message);
      return;
    }

    const hostCard = createShuffledCard();
    const guestCard = createShuffledCard();

    this.hostState = {
      roomId: roomCode,
      player1Card: hostCard,
      player2Card: guestCard,
      calledNumbers: [],
      lastCalledNumber: null,
      currentTurn: 1,
      gameOver: false,
      winner: null,
      player1Lines: 0,
      player2Lines: 0,
      p1Reset: false,
      p2Reset: false,
    };

    this.peer.on("open", () => {
      this.onStatusChange("connected");
      this.onMessage({
        type: "room_created",
        roomId: roomCode,
        playerNum: 1,
        playerCount: 1,
        ownCard: hostCard,
      });
    });

    this.peer.on("connection", (conn) => {
      this.conn = conn;

      conn.on("open", () => {
        // Send initial state to Guest
        conn.send({
          type: "room_joined",
          roomId: roomCode,
          playerNum: 2,
          ownCard: guestCard,
        });

        // Notify both that game has started
        setTimeout(() => {
          this.broadcastP2PGameState();
          this.onMessage({ type: "game_started" });
          conn.send({ type: "game_started" });
        }, 100);
      });

      conn.on("data", (data) => {
        this.handleP2PHostMessage(data);
      });

      conn.on("close", () => {
        this.onMessage({
          type: "game_state",
          opponentConnected: false,
          gameStatus: "opponent_disconnected",
        });
      });
    });

    this.peer.on("error", (err) => {
      console.error("PeerJS error:", err);
      if (err.type === "unavailable-id") {
        this.createRoom(playerId);
      } else {
        this.onError("Multiplayer connection error: " + (err.message || "Failed to create room."));
      }
    });
  }

  joinRoom(roomCode, playerId) {
    this.playerId = playerId;
    const cleanCode = roomCode.trim().toUpperCase();
    this.roomId = cleanCode;

    if (this.mode === "ws" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "join_room", roomId: cleanCode, playerId }));
      return;
    }

    // WebRTC P2P Mode
    this.mode = "p2p";
    this.isHost = false;
    this.playerNum = 2;

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
    }

    try {
      this.peer = new Peer({
        debug: 1,
      });
    } catch (err) {
      this.onError("Could not initialize connection: " + err.message);
      return;
    }

    this.peer.on("open", () => {
      this.onStatusChange("connected");
      const targetPeerId = PEER_PREFIX + cleanCode.toLowerCase();
      this.conn = this.peer.connect(targetPeerId, { reliable: true });

      this.conn.on("open", () => {
        this.conn.send({ type: "join_request", playerId });
      });

      this.conn.on("data", (data) => {
        this.onMessage(data);
      });

      this.conn.on("close", () => {
        this.onMessage({
          type: "game_state",
          opponentConnected: false,
          gameStatus: "opponent_disconnected",
        });
      });

      this.conn.on("error", (err) => {
        this.onError("Connection to room failed: " + err.message);
      });
    });

    this.peer.on("error", (err) => {
      console.error("Peer error:", err);
      this.onError("Could not find room " + cleanCode + ". Make sure the room code is correct.");
    });
  }

  selectNumber(number) {
    if (this.mode === "ws" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "select_number",
          roomId: this.roomId,
          number,
        })
      );
      return;
    }

    // WebRTC P2P
    if (this.isHost) {
      this.handleP2PHostMove(1, number);
    } else if (this.conn && this.conn.open) {
      this.conn.send({
        type: "select_number",
        number,
      });
    }
  }

  handleP2PHostMessage(data) {
    if (!this.hostState) return;

    if (data.type === "select_number") {
      this.handleP2PHostMove(2, data.number);
    } else if (data.type === "request_restart") {
      this.hostState.p2Reset = true;
      if (this.hostState.p1Reset && this.hostState.p2Reset) {
        this.startP2PRestart();
      } else {
        this.onMessage({ type: "restart_request" });
      }
    }
  }

  handleP2PHostMove(playerNum, number) {
    const state = this.hostState;
    if (!state || state.gameOver) return;
    if (state.currentTurn !== playerNum) return;
    if (state.calledNumbers.includes(number)) return;

    state.calledNumbers.push(number);
    state.lastCalledNumber = number;
    state.currentTurn = playerNum === 1 ? 2 : 1;

    const calledSet = new Set(state.calledNumbers);
    state.player1Lines = countLines(state.player1Card, calledSet);
    state.player2Lines = countLines(state.player2Card, calledSet);

    if (state.player1Lines >= 5 && state.player2Lines >= 5) {
      state.gameOver = true;
      state.winner = "draw";
    } else if (state.player1Lines >= 5) {
      state.gameOver = true;
      state.winner = "player1";
    } else if (state.player2Lines >= 5) {
      state.gameOver = true;
      state.winner = "player2";
    } else if (state.calledNumbers.length >= 25) {
      state.gameOver = true;
      state.winner = "draw";
    }

    this.broadcastP2PGameState();
  }

  requestRestart() {
    if (this.mode === "ws" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "request_restart", roomId: this.roomId, playerId: this.playerId }));
      return;
    }

    // P2P
    if (this.isHost) {
      this.hostState.p1Reset = true;
      if (this.hostState.p1Reset && this.hostState.p2Reset) {
        this.startP2PRestart();
      } else if (this.conn && this.conn.open) {
        this.conn.send({ type: "restart_request" });
      }
    } else if (this.conn && this.conn.open) {
      this.conn.send({ type: "request_restart" });
    }
  }

  startP2PRestart() {
    const hostCard = createShuffledCard();
    const guestCard = createShuffledCard();
    this.hostState = {
      roomId: this.roomId,
      player1Card: hostCard,
      player2Card: guestCard,
      calledNumbers: [],
      lastCalledNumber: null,
      currentTurn: 1,
      gameOver: false,
      winner: null,
      player1Lines: 0,
      player2Lines: 0,
      p1Reset: false,
      p2Reset: false,
    };

    // Update host
    this.onMessage({
      type: "room_created",
      roomId: this.roomId,
      playerNum: 1,
      playerCount: 2,
      ownCard: hostCard,
    });

    // Update guest
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: "room_joined",
        roomId: this.roomId,
        playerNum: 2,
        ownCard: guestCard,
      });
    }

    this.broadcastP2PGameState();
  }

  broadcastP2PGameState() {
    const state = this.hostState;
    if (!state) return;

    // Host View
    this.onMessage({
      type: "game_state",
      roomId: state.roomId,
      playerNum: 1,
      ownCard: state.player1Card,
      calledNumbers: state.calledNumbers,
      lastCalledNumber: state.lastCalledNumber,
      currentTurn: state.currentTurn,
      gameOver: state.gameOver,
      winner: state.winner,
      myLines: state.player1Lines,
      player1Lines: state.player1Lines,
      player2Lines: state.player2Lines,
      opponentCard: state.gameOver ? state.player2Card : null,
      opponentConnected: true,
      gameStatus: state.gameOver ? "game_over" : "in_progress",
    });

    // Guest View
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: "game_state",
        roomId: state.roomId,
        playerNum: 2,
        ownCard: state.player2Card,
        calledNumbers: state.calledNumbers,
        lastCalledNumber: state.lastCalledNumber,
        currentTurn: state.currentTurn,
        gameOver: state.gameOver,
        winner: state.winner,
        myLines: state.player2Lines,
        player1Lines: state.player1Lines,
        player2Lines: state.player2Lines,
        opponentCard: state.gameOver ? state.player1Card : null,
        opponentConnected: true,
        gameStatus: state.gameOver ? "game_over" : "in_progress",
      });
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.conn) {
      try {
        this.conn.close();
      } catch {}
      this.conn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {}
      this.peer = null;
    }
    this.onStatusChange("disconnected");
  }
}

// Line calculation helper
const LINE_DEFS = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    const l = [];
    for (let c = 0; c < 5; c++) l.push(r * 5 + c);
    lines.push(l);
  }
  for (let c = 0; c < 5; c++) {
    const l = [];
    for (let r = 0; r < 5; r++) l.push(r * 5 + c);
    lines.push(l);
  }
  const d1 = [], d2 = [];
  for (let i = 0; i < 5; i++) {
    d1.push(i * 5 + i);
    d2.push(i * 5 + (4 - i));
  }
  lines.push(d1, d2);
  return lines;
})();

function countLines(card, calledSet) {
  if (!card || card.length !== 25) return 0;
  let count = 0;
  for (const line of LINE_DEFS) {
    let full = true;
    for (const idx of line) {
      if (!calledSet.has(card[idx])) {
        full = false;
        break;
      }
    }
    if (full) count++;
  }
  return count;
}
