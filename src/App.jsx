import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { MultiplayerClient } from "./multiplayer";
import "./App.css";

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

function getCompletedLineIndices(card, calledSet) {
  if (!card || card.length !== 25) return [];
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

function getCompletedCellSet(card, calledSet) {
  if (!card || card.length !== 25) return new Set();
  const completedLines = getCompletedLineIndices(card, calledSet);
  const cellSet = new Set();
  for (const lineIdx of completedLines) {
    for (const cellIdx of LINE_DEFS[lineIdx]) {
      cellSet.add(cellIdx);
    }
  }
  return cellSet;
}

function resolveGameResult(p1Lines, p2Lines, totalCalled) {
  if (p1Lines >= 5 && p2Lines >= 5) return "draw";
  if (p1Lines >= 5) return "player1";
  if (p2Lines >= 5) return "player2";
  if (totalCalled >= 25) return "draw";
  return null;
}

function getFilledCellCountForLine(card, lineIdx, calledSet) {
  const cells = LINE_DEFS[lineIdx];
  let count = 0;
  for (const cellIdx of cells) {
    if (calledSet.has(card[cellIdx])) count++;
  }
  return count;
}

function chooseEasyMove(availableNumbers) {
  return availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
}

function chooseMediumMove(availableNumbers, aiCard, player1Card, calledSet) {
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(aiCard, nextSet).length >= 5) return num;
  }
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(player1Card, nextSet).length >= 5) return num;
  }
  let bestScore = -1;
  let bestMoves = [];
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    const aiLines = getCompletedLineIndices(aiCard, nextSet).length;
    let nearLines = 0;
    for (let i = 0; i < LINE_DEFS.length; i++) {
      if (getFilledCellCountForLine(aiCard, i, nextSet) === 4) nearLines++;
    }
    const score = aiLines * 10 + nearLines;
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [num];
    } else if (score === bestScore) {
      bestMoves.push(num);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function chooseHardMove(availableNumbers, aiCard, player1Card, calledSet) {
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(aiCard, nextSet).length >= 5) return num;
  }
  const p1WinningBlocks = [];
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(player1Card, nextSet).length >= 5) p1WinningBlocks.push(num);
  }
  if (p1WinningBlocks.length > 0) {
    return p1WinningBlocks[Math.floor(Math.random() * p1WinningBlocks.length)];
  }
  const currentAiLines = getCompletedLineIndices(aiCard, calledSet).length;
  const currentP1Lines = getCompletedLineIndices(player1Card, calledSet).length;
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    const aiLines = getCompletedLineIndices(aiCard, nextSet).length;
    const p1Lines = getCompletedLineIndices(player1Card, nextSet).length;
    const aiLineGain = aiLines - currentAiLines;
    const p1LineGain = p1Lines - currentP1Lines;
    let aiNear4 = 0, aiNear3 = 0, p1Near4 = 0;
    for (let i = 0; i < LINE_DEFS.length; i++) {
      const c = getFilledCellCountForLine(aiCard, i, nextSet);
      if (c === 4) aiNear4++;
      if (c === 3) aiNear3++;
    }
    for (let i = 0; i < LINE_DEFS.length; i++) {
      if (getFilledCellCountForLine(player1Card, i, nextSet) === 4) p1Near4++;
    }
    const score = aiLineGain * 5000 + p1LineGain * 3000 + aiNear4 * 500 + aiNear3 * 100 + p1Near4 * 50;
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [num];
    } else if (score === bestScore) {
      bestMoves.push(num);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function chooseAIMove(difficulty, availableNumbers, aiCard, player1Card, calledSet) {
  if (difficulty === "easy") return chooseEasyMove(availableNumbers);
  if (difficulty === "medium") return chooseMediumMove(availableNumbers, aiCard, player1Card, calledSet);
  return chooseHardMove(availableNumbers, aiCard, player1Card, calledSet);
}

function BingoCard({ card, calledSet, completedCellSet, playerNum, isActive, lines, cardStatus, onNumberClick, gameMode, lastCalledNumber }) {
  const isPlayer1 = playerNum === 1;
  const isAiMode = gameMode === "ai";
  const label = isPlayer1 ? (isAiMode ? "YOUR CARD" : "PLAYER 1 CARD") : (isAiMode ? "AI CARD" : "PLAYER 2 CARD");
  const lineLabel = isPlayer1 ? (isAiMode ? "YOUR" : "PLAYER 1") : (isAiMode ? "AI" : "PLAYER 2");
  const variant = isPlayer1 ? "p1" : "p2";
  return (
    <div className={`card-section ${variant}-section ${isActive ? "active-card" : "inactive-card"}`}>
      <h3 className="card-label">{label}</h3>
      <div className="card-meta">
        <span className="card-lines">{lineLabel} LINES: {lines}/5</span>
        <span className={`card-status card-status-${cardStatus.type}`}>{cardStatus.text}</span>
      </div>
      <div className={`bingo-grid ${variant}-grid`}>
        {card.map((number, index) => {
          const isCalled = calledSet.has(number);
          const isLineCell = completedCellSet.has(index);
          const isLastCalled = lastCalledNumber === number;
          const clickable = isActive && !isCalled;
          return (
            <div
              key={index}
              className={`bingo-cell ${variant}-cell ${isCalled ? "called" : ""} ${isLineCell ? "line-cell" : ""} ${isLastCalled ? "last-called" : ""} ${clickable ? "clickable" : ""}`}
              onClick={() => clickable && onNumberClick(number)}
            >
              <span className="cell-num">{number}</span>
              {isCalled && <span className="cell-check">✓</span>}
              {isLastCalled && <span className="cell-last-badge">LAST</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HiddenOpponentCard({ opponentConnected }) {
  const placeholderCells = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="card-section p2-section inactive-card online-hidden-opponent">
      <h3 className="card-label">OPPONENT CARD</h3>
      <div className="card-meta">
        <span className="card-lines">OPPONENT: 🔒 HIDDEN</span>
        <span className={`card-status ${opponentConnected ? "card-status-wait" : "card-status-lose"}`}>
          {opponentConnected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="bingo-grid p2-grid hidden-card-grid">
        <div className="hidden-card-overlay">
          <div className="lock-icon">🔒</div>
          <div className="lock-title">OPPONENT CARD</div>
          <div className="lock-desc">Revealed after game ends</div>
        </div>
        {placeholderCells.map((idx) => (
          <div key={idx} className="bingo-cell p2-cell hidden-placeholder-cell">?</div>
        ))}
      </div>
    </div>
  );
}

function generatePlayerId() {
  return "pid_" + Math.random().toString(36).substring(2, 11);
}

function getStoredPlayerId() {
  try {
    let id = sessionStorage.getItem("bingo_player_id");
    if (!id) {
      id = generatePlayerId();
      sessionStorage.setItem("bingo_player_id", id);
    }
    return id;
  } catch {
    return generatePlayerId();
  }
}

/**
 * Resolves the WebSocket URL:
 * 1. If import.meta.env.VITE_WS_URL is provided, use it.
 * 2. If running locally (localhost / 127.0.0.1), fall back to ws://localhost:8080.
 * 3. On deployed static hosts (e.g. Netlify), DO NOT default to the Netlify domain!
 *    Return null so we can prompt the user to configure VITE_WS_URL.
 */
function getResolvedWsUrl() {
  const envUrl = (import.meta.env.VITE_WS_URL || "").trim();

  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    const isLocalhost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("192.168.") ||
      host.startsWith("172.") ||
      host.endsWith(".local");

    // If on a public deployed website and envUrl points to localhost, ignore it to use free P2P
    if (!isLocalhost && envUrl && (envUrl.includes("localhost") || envUrl.includes("127.0.0.1"))) {
      return null;
    }

    if (envUrl && !envUrl.includes("localhost")) return envUrl;
    if (isLocalhost) return "ws://" + host + ":8080";
  }

  return envUrl || null;
}

function App() {
  const [screen, setScreen] = useState("mode_select");
  const [gameMode, setGameMode] = useState(null);
  const [difficulty, setDifficulty] = useState("medium");

  const [player1Card, setPlayer1Card] = useState(() => createShuffledCard());
  const [player2Card, setPlayer2Card] = useState(() => createShuffledCard());
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastCalledNumber, setLastCalledNumber] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [aiThinking, setAiThinking] = useState(false);

  const [onlineLobbyView, setOnlineLobbyView] = useState("menu");
  const [roomId, setRoomId] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [onlinePlayerNum, setOnlinePlayerNum] = useState(1);
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(1);
  const [myOnlineCard, setMyOnlineCard] = useState([]);
  const [opponentOnlineCard, setOpponentOnlineCard] = useState(null);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [onlineError, setOnlineError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [onlineResetRequested, setOnlineResetRequested] = useState(false);
  const [onlineOpponentResetRequested, setOnlineOpponentResetRequested] = useState(false);

  // Multiplayer client state
  const [wsStatus, setWsStatus] = useState("disconnected"); // "connecting" | "connected" | "disconnected"
  const [myOnlineLines, setMyOnlineLines] = useState(0);
  const [opponentOnlineLines, setOpponentOnlineLines] = useState(0);

  const clientRef = useRef(null);
  const aiTimeoutRef = useRef(null);
  const playerIdRef = useRef(getStoredPlayerId());
  const currentRoomIdRef = useRef("");

  const activeWsUrl = getResolvedWsUrl();

  const clearAiTimeout = () => {
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
  };

  const handleMultiplayerMessage = useCallback((data) => {
    if (!data) return;

    if (data.type === "connected") {
      setWsStatus("connected");
      return;
    }

    if (data.type === "room_created") {
      currentRoomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setOnlinePlayerNum(data.playerNum || 1);
      setOnlinePlayerCount(data.playerCount || 1);
      const card = data.ownCard || data.myCard || [];
      setMyOnlineCard(card);
      setOpponentOnlineCard(null);
      setOnlineError("");
      setOnlineLobbyView("waiting");
      return;
    }

    if (data.type === "room_joined") {
      currentRoomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setOnlinePlayerNum(data.playerNum || 2);
      const card = data.ownCard || data.myCard || [];
      setMyOnlineCard(card);
      setOpponentOnlineCard(null);
      setOnlineError("");
      return;
    }

    if (data.type === "game_started") {
      setScreen("game");
      setOnlineError("");
      return;
    }

    if (data.type === "invalid_move" || data.type === "error") {
      setOnlineError(data.message || "An error occurred.");
      return;
    }

    if (data.type === "game_state") {
      if (data.roomId) {
        currentRoomIdRef.current = data.roomId;
        setRoomId(data.roomId);
      }
      if (data.playerNum) setOnlinePlayerNum(data.playerNum);
      const card = data.ownCard || data.myCard;
      if (card && card.length === 25) setMyOnlineCard(card);

      setCalledNumbers(data.calledNumbers || []);
      setLastCalledNumber(data.lastCalledNumber != null ? data.lastCalledNumber : null);
      setCurrentPlayer(data.currentTurn || 1);
      setGameOver(!!data.gameOver);
      setWinner(data.winner || null);
      setOpponentConnected(data.opponentConnected !== false);
      setOnlineResetRequested(!!data.myResetRequested);
      setOnlineOpponentResetRequested(!!data.resetRequestedByOpponent);

      if (typeof data.myLines === "number") {
        setMyOnlineLines(data.myLines);
      }

      if (data.gameOver) {
        const myNum = data.playerNum || onlinePlayerNum;
        if (typeof data.player1Lines === "number" || typeof data.player2Lines === "number") {
          const oppLines = myNum === 1 ? data.player2Lines : data.player1Lines;
          if (typeof oppLines === "number") setOpponentOnlineLines(oppLines);
        }
        const oppCard = data.opponentCard || (myNum === 1 ? data.player2Card : data.player1Card);
        if (oppCard) setOpponentOnlineCard(oppCard);
      } else {
        setOpponentOnlineCard(null);
      }

      if (data.gameStatus === "in_progress" || data.gameStatus === "game_over" || data.gameStatus === "opponent_disconnected") {
        setScreen("game");
      } else if (data.gameStatus === "waiting") {
        setOnlinePlayerCount(data.playerCount || 1);
        setOnlineLobbyView("waiting");
      }
      return;
    }

    if (data.type === "restart_request") {
      setOnlineOpponentResetRequested(true);
      return;
    }

    if (data.type === "restart_accepted") {
      setOnlineResetRequested(false);
      setOnlineOpponentResetRequested(false);
      return;
    }

    if (data.type === "restart_declined") {
      setOnlineResetRequested(false);
      setOnlineOpponentResetRequested(false);
      setOnlineError(data.message || "Opponent declined new game.");
      return;
    }
  }, [onlinePlayerNum]);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new MultiplayerClient({
        wsUrl: getResolvedWsUrl(),
        onStatusChange: (status) => setWsStatus(status),
        onError: (errMsg) => setOnlineError(errMsg),
        onMessage: handleMultiplayerMessage,
      });
    }
    return clientRef.current;
  }, [handleMultiplayerMessage]);

  const disconnectMultiplayer = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setWsStatus("disconnected");
  }, []);

  const connectMultiplayer = useCallback((onReady) => {
    const client = getClient();
    client.connect(onReady);
  }, [getClient]);

  // Connect automatically when opening online mode
  useEffect(() => {
    if (screen === "online_lobby" && wsStatus === "disconnected") {
      connectMultiplayer();
    }
  }, [screen, wsStatus, connectMultiplayer]);

  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);

  const p1Lines = useMemo(() => countCompletedLines(player1Card, calledSet), [player1Card, calledSet]);
  const p2Lines = useMemo(() => countCompletedLines(player2Card, calledSet), [player2Card, calledSet]);

  const calculatedMyOnlineLines = useMemo(() => countCompletedLines(myOnlineCard, calledSet), [myOnlineCard, calledSet]);
  const calculatedOpponentOnlineLines = useMemo(() => {
    return opponentOnlineCard ? countCompletedLines(opponentOnlineCard, calledSet) : 0;
  }, [opponentOnlineCard, calledSet]);

  const p1CompletedCells = useMemo(() => getCompletedCellSet(player1Card, calledSet), [player1Card, calledSet]);
  const p2CompletedCells = useMemo(() => getCompletedCellSet(player2Card, calledSet), [player2Card, calledSet]);
  const myOnlineCompletedCells = useMemo(() => getCompletedCellSet(myOnlineCard, calledSet), [myOnlineCard, calledSet]);
  const opponentOnlineCompletedCells = useMemo(() => {
    return opponentOnlineCard ? getCompletedCellSet(opponentOnlineCard, calledSet) : new Set();
  }, [opponentOnlineCard, calledSet]);

  const executeLocalCall = (number) => {
    const newCalled = [...calledNumbers, number];
    const newCalledSet = new Set(newCalled);
    const newP1Lines = countCompletedLines(player1Card, newCalledSet);
    const newP2Lines = countCompletedLines(player2Card, newCalledSet);
    const result = resolveGameResult(newP1Lines, newP2Lines, newCalled.length);

    setCalledNumbers(newCalled);
    setLastCalledNumber(number);

    if (result !== null) {
      setWinner(result);
      setGameOver(true);
      setAiThinking(false);
    } else {
      setCurrentPlayer((prev) => (prev === 1 ? 2 : 1));
    }
  };

  const handleNumberClick = (playerNum, number) => {
    if (gameMode === "online") {
      if (gameOver) return;
      if (currentPlayer !== onlinePlayerNum) return;
      if (calledSet.has(number)) return;

      // Optimistic UI update for instant feedback
      setCalledNumbers((prev) => (prev.includes(number) ? prev : [...prev, number]));
      setLastCalledNumber(number);

      getClient().selectNumber(number);
      return;
    }

    if (gameOver || aiThinking) return;
    if (currentPlayer !== playerNum) return;
    if (calledSet.has(number)) return;

    executeLocalCall(number);
  };

  useEffect(() => {
    if (screen === "game" && gameMode === "ai" && currentPlayer === 2 && !gameOver) {
      setAiThinking(true);
      clearAiTimeout();
      const delay = difficulty === "easy" ? 750 : difficulty === "medium" ? 1050 : 1400;
      aiTimeoutRef.current = setTimeout(() => {
        const available = Array.from({ length: 25 }, (_, i) => i + 1).filter((num) => !calledSet.has(num));
        if (available.length > 0) {
          const aiChoice = chooseAIMove(difficulty, available, player2Card, player1Card, calledSet);
          setAiThinking(false);
          executeLocalCall(aiChoice);
        }
      }, delay);
    } else {
      setAiThinking(false);
    }
    return () => clearAiTimeout();
  }, [currentPlayer, gameMode, gameOver, calledSet, screen, difficulty, player1Card, player2Card]);

  const resetOnlineState = () => {
    setCalledNumbers([]);
    setLastCalledNumber(null);
    setCurrentPlayer(1);
    setGameOver(false);
    setWinner(null);
    setMyOnlineLines(0);
    setOpponentOnlineLines(0);
    setOpponentOnlineCard(null);
    setMyOnlineCard([]);
    setOnlineError("");
    setOnlineResetRequested(false);
    setOnlineOpponentResetRequested(false);
  };

  const selectGameMode = (mode) => {
    clearAiTimeout();
    setGameMode(mode);
    setOnlineError("");

    if (mode === "two_player") {
      disconnectMultiplayer();
      startNewLocalGame("two_player", difficulty);
    } else if (mode === "ai") {
      disconnectMultiplayer();
      setScreen("diff_select");
    } else if (mode === "online") {
      setScreen("online_lobby");
      setOnlineLobbyView("menu");
      setRoomId("");
      setJoinCodeInput("");
      resetOnlineState();
      connectMultiplayer();
    }
  };

  const selectDifficultyAndStart = (selectedDiff) => {
    clearAiTimeout();
    setDifficulty(selectedDiff);
    startNewLocalGame("ai", selectedDiff);
  };

  const startNewLocalGame = (mode, diff) => {
    clearAiTimeout();
    setGameMode(mode);
    setDifficulty(diff);
    setScreen("game");
    setPlayer1Card(createShuffledCard());
    setPlayer2Card(createShuffledCard());
    setCalledNumbers([]);
    setLastCalledNumber(null);
    setCurrentPlayer(1);
    setGameOver(false);
    setWinner(null);
    setAiThinking(false);
  };

  const handleCreateOnlineGame = () => {
    setOnlineError("");
    connectMultiplayer(() => {
      getClient().createRoom(playerIdRef.current);
    });
  };

  const handleJoinOnlineGame = () => {
    const cleanCode = joinCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setOnlineError("Please enter a valid 6-character game code.");
      return;
    }
    setOnlineError("");
    connectMultiplayer(() => {
      getClient().joinRoom(cleanCode, playerIdRef.current);
    });
  };

  const handleCopyRoomCode = () => {
    if (!roomId) return;
    const fallbackCopy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = roomId;
        ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } catch {}
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(roomId)
        .then(() => {
          setCopiedCode(true);
          setTimeout(() => setCopiedCode(false), 2000);
        })
        .catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  const handleRequestOnlineReset = () => {
    getClient().requestRestart();
    setOnlineResetRequested(true);
  };

  const handleLeaveOnlineGame = () => {
    disconnectMultiplayer();
    currentRoomIdRef.current = "";
    setScreen("mode_select");
    setGameMode(null);
    setRoomId("");
    resetOnlineState();
  };

  const handleReset = () => {
    if (gameMode === "online") {
      handleRequestOnlineReset();
    } else if (gameMode) {
      startNewLocalGame(gameMode, difficulty);
    }
  };

  const handleChangeDifficulty = () => {
    clearAiTimeout();
    setScreen("diff_select");
    setCalledNumbers([]);
    setLastCalledNumber(null);
    setCurrentPlayer(1);
    setGameOver(false);
    setWinner(null);
    setAiThinking(false);
  };

  const handleChangeMode = () => {
    clearAiTimeout();
    disconnectMultiplayer();
    currentRoomIdRef.current = "";
    setScreen("mode_select");
    setGameMode(null);
    setCalledNumbers([]);
    setLastCalledNumber(null);
    setCurrentPlayer(1);
    setGameOver(false);
    setWinner(null);
    setAiThinking(false);
    resetOnlineState();
  };

  const getGameStatusText = () => {
    if (gameMode === "online") {
      if (!opponentConnected && !gameOver) return "Opponent Disconnected";
      if (winner === "player1") return onlinePlayerNum === 1 ? "You Win!" : "Player 1 Wins";
      if (winner === "player2") return onlinePlayerNum === 2 ? "You Win!" : "Player 2 Wins";
      if (winner === "draw") return "Draw";
      return currentPlayer === onlinePlayerNum ? "Your Turn" : "Opponent's Turn";
    }
    if (winner === "player1") return gameMode === "ai" ? "You Win!" : "Player 1 Wins";
    if (winner === "player2") return gameMode === "ai" ? "AI Wins" : "Player 2 Wins";
    if (winner === "draw") return "Draw";
    if (gameMode === "ai") return currentPlayer === 1 ? "Your Turn" : "AI's Turn";
    return currentPlayer === 1 ? "Player 1's Turn" : "Player 2's Turn";
  };

  const getCardStatus = (playerNum) => {
    const isCurrent = currentPlayer === playerNum && !gameOver;
    if (winner === `player${playerNum}`) return { type: "win", text: "WINS!" };
    if (winner === "draw") return { type: "draw", text: "Draw" };
    if (winner !== null) return { type: "lose", text: "Lost" };
    if (isCurrent) {
      if (gameMode === "ai" && playerNum === 2) return { type: "turn", text: "Thinking..." };
      return { type: "turn", text: "Your Turn" };
    }
    return { type: "wait", text: "Waiting" };
  };

  const getTurnIndicatorText = () => {
    if (gameOver) return "";
    if (gameMode === "online") {
      if (!opponentConnected) return "🔴 OPPONENT DISCONNECTED";
      return currentPlayer === onlinePlayerNum ? "🟢 YOUR TURN" : "⏳ OPPONENT'S TURN";
    }
    if (gameMode === "ai") return currentPlayer === 1 ? "🟢 YOUR TURN" : "🤖 AI IS THINKING...";
    return currentPlayer === 1 ? "🟢 PLAYER 1'S TURN" : "🔵 PLAYER 2'S TURN";
  };

  const getBingoMessage = () => {
    if (gameMode === "online") {
      if (winner === "player1") return onlinePlayerNum === 1 ? "🎉 BINGO! YOU WIN!" : "🎉 BINGO! PLAYER 1 WINS!";
      if (winner === "player2") return onlinePlayerNum === 2 ? "🎉 BINGO! YOU WIN!" : "🎉 BINGO! PLAYER 2 WINS!";
      if (winner === "draw") return "🤝 DRAW!";
      return null;
    }
    if (winner === "player1") return gameMode === "ai" ? "🎉 BINGO! YOU WIN!" : "🎉 BINGO! PLAYER 1 WINS!";
    if (winner === "player2") return gameMode === "ai" ? "🤖 BINGO! AI WINS!" : "🎉 BINGO! PLAYER 2 WINS!";
    if (winner === "draw") return "🤝 DRAW!";
    return null;
  };

  const wsStatusLabel = wsStatus === "connecting" ? "🟡 CONNECTING" : wsStatus === "connected" ? "🟢 CONNECTED" : "🔴 DISCONNECTED";
  const wsStatusClass = wsStatus === "connecting" ? "conn-connecting" : wsStatus === "connected" ? "conn-online" : "conn-offline";

  const effectiveMyLines = myOnlineLines || calculatedMyOnlineLines;
  const effectiveOppLines = opponentOnlineLines || calculatedOpponentOnlineLines;

  if (screen === "mode_select") {
    return (
      <div className="bingo-app mode-selection-page">
        <h1 className="title">BINGO</h1>
        <p className="subtitle">Choose your game mode</p>
        <div className="mode-selection-container">
          <button className="mode-card mode-ai" onClick={() => selectGameMode("ai")}>
            <div className="mode-icon">🤖</div>
            <div className="mode-title">PLAY AGAINST AI</div>
            <div className="mode-desc">Challenge the computer in a single-player match</div>
          </button>
          <button className="mode-card mode-two-player" onClick={() => selectGameMode("two_player")}>
            <div className="mode-icon">👥</div>
            <div className="mode-title">TWO PLAYER</div>
            <div className="mode-desc">Play locally with a friend on the same screen</div>
          </button>
          <button className="mode-card mode-online" onClick={() => selectGameMode("online")}>
            <div className="mode-icon">🌐</div>
            <div className="mode-title">ONLINE MODE</div>
            <div className="mode-desc">Play real-time multiplayer with a private card</div>
          </button>
        </div>
      </div>
    );
  }

  if (screen === "diff_select") {
    return (
      <div className="bingo-app mode-selection-page">
        <h1 className="title">BINGO</h1>
        <p className="subtitle">CHOOSE DIFFICULTY</p>
        <div className="diff-selection-container">
          <button className="diff-card diff-easy" onClick={() => selectDifficultyAndStart("easy")}>
            <div className="diff-badge">🟢 EASY</div>
            <div className="diff-desc">AI chooses randomly and makes simple decisions.</div>
          </button>
          <button className="diff-card diff-medium" onClick={() => selectDifficultyAndStart("medium")}>
            <div className="diff-badge">🟡 MEDIUM</div>
            <div className="diff-desc">AI tries to complete its own lines while occasionally blocking you.</div>
          </button>
          <button className="diff-card diff-hard" onClick={() => selectDifficultyAndStart("hard")}>
            <div className="diff-badge">🔴 HARD</div>
            <div className="diff-desc">AI intelligently prioritizes winning and blocking your strongest moves.</div>
          </button>
        </div>
        <button className="btn btn-back" onClick={() => setScreen("mode_select")}>← BACK</button>
      </div>
    );
  }

  if (screen === "online_lobby") {
    return (
      <div className="bingo-app mode-selection-page">
        <h1 className="title">BINGO</h1>
        <p className="subtitle">🌐 ONLINE BINGO</p>

        <div className="online-status-bar">
          <span className={`ws-status-badge ${wsStatusClass}`}>{wsStatusLabel}</span>
          <span className="ws-debug-info">
            Multiplayer Engine: <code>{activeWsUrl ? `WebSocket (${activeWsUrl})` : "WebRTC P2P (100% Free - Serverless)"}</code>
          </span>
        </div>

        {onlineError && (
          <div className="online-error-banner">
            <div>{onlineError}</div>
            {wsStatus === "disconnected" && (
              <button className="btn btn-retry" onClick={() => connectMultiplayer()}>
                🔄 RETRY CONNECTION
              </button>
            )}
          </div>
        )}

        {onlineLobbyView === "menu" && (
          <div className="online-lobby-menu">
            <div className="lobby-options-container">
              <button
                className="lobby-action-card create-card"
                onClick={handleCreateOnlineGame}
              >
                <div className="lobby-card-icon">➕</div>
                <div className="lobby-card-title">CREATE GAME</div>
                <div className="lobby-card-desc">
                  {wsStatus === "connecting" ? "Connecting to server..." : "Generate a game code and wait for a friend"}
                </div>
              </button>
              <button className="lobby-action-card join-card" onClick={() => setOnlineLobbyView("join")}>
                <div className="lobby-card-icon">🔑</div>
                <div className="lobby-card-title">JOIN GAME</div>
                <div className="lobby-card-desc">Enter an existing game code to play with an opponent</div>
              </button>
            </div>
            <button className="btn btn-back" onClick={handleChangeMode}>← BACK TO MODES</button>
          </div>
        )}

        {onlineLobbyView === "join" && (
          <div className="online-lobby-join-panel">
            <div className="join-form-card">
              <h3 className="join-form-title">ENTER GAME CODE</h3>
              <input
                type="text"
                className="join-code-input"
                placeholder="e.g. B7K4P2"
                maxLength={6}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoinOnlineGame()}
              />
              <div className="join-btn-group">
                <button className="btn btn-join-submit" onClick={handleJoinOnlineGame}>
                  {wsStatus === "connecting" ? "CONNECTING..." : "JOIN GAME"}
                </button>
                <button className="btn btn-back" onClick={() => setOnlineLobbyView("menu")}>← BACK</button>
              </div>
            </div>
          </div>
        )}

        {onlineLobbyView === "waiting" && (
          <div className="online-waiting-panel">
            <div className="waiting-card">
              <div className="waiting-badge">Players: {onlinePlayerCount}/2</div>
              <div className="room-code-label">GAME CODE</div>
              <div className="room-code-display">{roomId}</div>
              <button className="btn btn-copy-code" onClick={handleCopyRoomCode}>
                {copiedCode ? "✅ COPIED!" : "📋 COPY CODE"}
              </button>
              <div className="waiting-status-text">
                <span className="spinner-dot"></span> Waiting for opponent to join...
              </div>
              <button className="btn btn-leave-lobby" onClick={handleLeaveOnlineGame}>LEAVE GAME</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const bingoMsg = getBingoMessage();

  return (
    <div className="bingo-app">
      <h1 className="title">BINGO</h1>

      {gameMode === "ai" && (
        <div className={`difficulty-banner diff-tag-${difficulty}`}>
          AI DIFFICULTY: {difficulty.toUpperCase()}
        </div>
      )}

      {gameMode === "online" && (
        <div className="online-room-banner">
          <span className="online-tag">🌐 ONLINE MODE</span>
          <span className="room-badge">ROOM: {roomId}</span>
          <span className={`conn-tag ${wsStatusClass}`}>{wsStatusLabel}</span>
          <span className={`conn-tag ${opponentConnected ? "conn-online" : "conn-offline"}`}>
            Opponent: {opponentConnected ? "🟢 Online" : "🔴 Disconnected"}
          </span>
        </div>
      )}

      {bingoMsg && (
        <div className={`bingo-message ${winner === "player1" ? "p1-win" : winner === "player2" ? "p2-win" : "draw-message"}`}>
          {bingoMsg}
        </div>
      )}

      <div className={`turn-indicator ${currentPlayer === 1 && !gameOver ? "p1-turn" : ""} ${currentPlayer === 2 && !gameOver ? "p2-turn" : ""} ${gameOver ? "game-over" : ""}`}>
        {getTurnIndicatorText()}
      </div>

      <div className="status-panel">
        <div className="current-call">
          <span className="current-call-label">LAST CALLED NUMBER</span>
          <span className={`current-call-number ${lastCalledNumber === null ? "placeholder" : ""}`}>
            {lastCalledNumber !== null ? lastCalledNumber : "—"}
          </span>
        </div>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">{gameMode === "online" ? "Your Lines" : gameMode === "ai" ? "Your Lines" : "Player 1 Lines"}</span>
            <span className="status-value p1-lines">{gameMode === "online" ? `${effectiveMyLines}/5` : `${p1Lines}/5`}</span>
          </div>
          <div className="status-item">
            <span className="status-label">{gameMode === "online" ? "Opponent Lines" : gameMode === "ai" ? "AI Lines" : "Player 2 Lines"}</span>
            <span className="status-value p2-lines">
              {gameMode === "online" ? (gameOver && opponentOnlineCard ? `${effectiveOppLines}/5` : "🔒 Hidden") : `${p2Lines}/5`}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Called</span>
            <span className="status-value">{calledNumbers.length}/25</span>
          </div>
          <div className="status-item">
            <span className="status-label">Game Status</span>
            <span className="status-value">{getGameStatusText()}</span>
          </div>
        </div>
        {calledNumbers.length > 0 && (
          <div className="called-history">
            <span className="status-label">Called Numbers:</span>
            <div className="called-history-list">
              {calledNumbers.map((n, i) => (
                <span key={i} className="called-history-chip">{n}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="cards-container">
        {gameMode === "online" ? (
          <>
            <div className={`card-section ${onlinePlayerNum === 1 ? "p1-section" : "p2-section"} active-card`}>
              <h3 className="card-label">YOUR CARD (PLAYER {onlinePlayerNum})</h3>
              <div className="card-meta">
                <span className="card-lines">YOUR LINES: {effectiveMyLines}/5</span>
                <span className={`card-status card-status-${winner === `player${onlinePlayerNum}` ? "win" : winner === "draw" ? "draw" : winner !== null ? "lose" : currentPlayer === onlinePlayerNum && !gameOver ? "turn" : "wait"}`}>
                  {winner === `player${onlinePlayerNum}` ? "WINS!" : winner === "draw" ? "Draw" : winner !== null ? "Lost" : currentPlayer === onlinePlayerNum && !gameOver ? "Your Turn" : "Waiting"}
                </span>
              </div>
              <div className={`bingo-grid ${onlinePlayerNum === 1 ? "p1-grid" : "p2-grid"}`}>
                {myOnlineCard.map((number, index) => {
                  const isCalled = calledSet.has(number);
                  const isLineCell = myOnlineCompletedCells.has(index);
                  const isLastCalled = lastCalledNumber === number;
                  const clickable = !gameOver && currentPlayer === onlinePlayerNum && !isCalled && opponentConnected && wsStatus === "connected";
                  return (
                    <div
                      key={index}
                      className={`bingo-cell ${onlinePlayerNum === 1 ? "p1-cell" : "p2-cell"} ${isCalled ? "called" : ""} ${isLineCell ? "line-cell" : ""} ${isLastCalled ? "last-called" : ""} ${clickable ? "clickable" : ""}`}
                      onClick={() => clickable && handleNumberClick(onlinePlayerNum, number)}
                    >
                      <span className="cell-num">{number}</span>
                      {isCalled && <span className="cell-check">✓</span>}
                      {isLastCalled && <span className="cell-last-badge">LAST</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {gameOver && opponentOnlineCard ? (
              <div className={`card-section ${onlinePlayerNum === 1 ? "p2-section" : "p1-section"} active-card reveal-opponent-card`}>
                <h3 className="card-label">OPPONENT FINAL CARD (PLAYER {onlinePlayerNum === 1 ? 2 : 1})</h3>
                <div className="card-meta">
                  <span className="card-lines">OPPONENT LINES: {effectiveOppLines}/5</span>
                  <span className={`card-status card-status-${winner === `player${onlinePlayerNum === 1 ? 2 : 1}` ? "win" : winner === "draw" ? "draw" : "lose"}`}>
                    {winner === `player${onlinePlayerNum === 1 ? 2 : 1}` ? "WINS!" : winner === "draw" ? "Draw" : "Lost"}
                  </span>
                </div>
                <div className={`bingo-grid ${onlinePlayerNum === 1 ? "p2-grid" : "p1-grid"}`}>
                  {opponentOnlineCard.map((number, index) => {
                    const isCalled = calledSet.has(number);
                    const isLineCell = opponentOnlineCompletedCells.has(index);
                    const isLastCalled = lastCalledNumber === number;
                    return (
                      <div key={index} className={`bingo-cell ${onlinePlayerNum === 1 ? "p2-cell" : "p1-cell"} ${isCalled ? "called" : ""} ${isLineCell ? "line-cell" : ""} ${isLastCalled ? "last-called" : ""}`}>
                        <span className="cell-num">{number}</span>
                        {isCalled && <span className="cell-check">✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <HiddenOpponentCard opponentConnected={opponentConnected} />
            )}
          </>
        ) : (
          <>
            <BingoCard
              card={player1Card}
              calledSet={calledSet}
              completedCellSet={p1CompletedCells}
              playerNum={1}
              isActive={!gameOver && currentPlayer === 1 && !aiThinking}
              lines={p1Lines}
              cardStatus={getCardStatus(1)}
              onNumberClick={(num) => handleNumberClick(1, num)}
              gameMode={gameMode}
              lastCalledNumber={lastCalledNumber}
            />
            <BingoCard
              card={player2Card}
              calledSet={calledSet}
              completedCellSet={p2CompletedCells}
              playerNum={2}
              isActive={!gameOver && currentPlayer === 2 && gameMode === "two_player"}
              lines={p2Lines}
              cardStatus={getCardStatus(2)}
              onNumberClick={(num) => handleNumberClick(2, num)}
              gameMode={gameMode}
              lastCalledNumber={lastCalledNumber}
            />
          </>
        )}
      </div>

      <div className="controls">
        {gameMode === "online" ? (
          <>
            <button
              className={`btn btn-reset ${onlineResetRequested ? "btn-pending" : ""}`}
              onClick={handleRequestOnlineReset}
              disabled={onlineResetRequested || wsStatus !== "connected"}
            >
              {onlineResetRequested ? "⏳ WAITING FOR OPPONENT..." : onlineOpponentResetRequested ? "🤝 ACCEPT NEW GAME" : "🔄 REQUEST NEW GAME"}
            </button>
            <button className="btn btn-leave" onClick={handleLeaveOnlineGame}>🚪 LEAVE GAME</button>
            <button className="btn btn-mode" onClick={handleChangeMode}>⚙️ CHANGE MODE</button>
          </>
        ) : (
          <>
            <button className="btn btn-reset" onClick={handleReset}>🔄 RESET GAME</button>
            {gameMode === "ai" && (
              <button className="btn btn-diff" onClick={handleChangeDifficulty}>🎯 CHANGE DIFFICULTY</button>
            )}
            <button className="btn btn-mode" onClick={handleChangeMode}>⚙️ CHANGE MODE</button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
