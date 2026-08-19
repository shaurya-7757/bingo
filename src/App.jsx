import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { MultiplayerClient } from "./multiplayer";
import * as authService from "./services/authService";
import * as friendService from "./services/friendService";
import * as historyService from "./services/historyService";
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
  if (!availableNumbers || availableNumbers.length === 0) return 1;
  return availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
}

function chooseMediumMove(availableNumbers, aiCard, player1Card, calledSet) {
  if (!availableNumbers || availableNumbers.length === 0) return 1;

  // 1. Winning move for AI
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(aiCard, nextSet).length >= 5) return num;
  }
  // 2. Block player's winning move
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(player1Card, nextSet).length >= 5) return num;
  }

  // 3. Best line progress
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

  if (bestMoves.length > 0) {
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  return chooseEasyMove(availableNumbers);
}

function chooseHardMove(availableNumbers, aiCard, player1Card, calledSet) {
  if (!availableNumbers || availableNumbers.length === 0) return 1;

  // 1. Immediate Win
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(aiCard, nextSet).length >= 5) return num;
  }

  // 2. Immediate Block
  const p1WinningBlocks = [];
  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    if (getCompletedLineIndices(player1Card, nextSet).length >= 5) p1WinningBlocks.push(num);
  }
  if (p1WinningBlocks.length > 0) {
    return p1WinningBlocks[Math.floor(Math.random() * p1WinningBlocks.length)];
  }

  // 3. Multi-factor heuristic
  const currentAiLines = getCompletedLineIndices(aiCard, calledSet).length;
  let bestScore = -Infinity;
  let bestMoves = [];

  for (const num of availableNumbers) {
    const nextSet = new Set(calledSet).add(num);
    const newAiLines = getCompletedLineIndices(aiCard, nextSet).length;
    const linesGained = newAiLines - currentAiLines;
    let aiFourCount = 0, aiThreeCount = 0;
    for (let i = 0; i < LINE_DEFS.length; i++) {
      const filled = getFilledCellCountForLine(aiCard, i, nextSet);
      if (filled === 4) aiFourCount++;
      else if (filled === 3) aiThreeCount++;
    }
    let p1Blocks = 0;
    for (let i = 0; i < LINE_DEFS.length; i++) {
      const p1Filled = getFilledCellCountForLine(player1Card, i, calledSet);
      if (p1Filled === 3 && player1Card.includes(num)) p1Blocks++;
    }
    const score = linesGained * 100 + aiFourCount * 30 + p1Blocks * 20 + aiThreeCount * 5;
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [num];
    } else if (score === bestScore) {
      bestMoves.push(num);
    }
  }

  if (bestMoves.length > 0) {
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  return chooseEasyMove(availableNumbers);
}

function getResolvedWsUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && envUrl.trim()) return envUrl.trim();
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (isLocalhost) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:8080`;
  }
  return null;
}

function ThemeToggle({ theme, setTheme }) {
  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("bingo_theme", newTheme);
  };

  return (
    <div className="theme-toggle-bar">
      <span className="theme-toggle-label">THEME</span>
      <div className="theme-toggle-group">
        <button
          type="button"
          className={`theme-btn ${theme === "light" ? "active" : ""}`}
          onClick={() => toggleTheme("light")}
        >
          LIGHT
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === "dark" ? "active" : ""}`}
          onClick={() => toggleTheme("dark")}
        >
          DARK
        </button>
      </div>
    </div>
  );
}

function BingoCard({
  card,
  calledSet,
  completedCellSet,
  playerNum,
  isActive,
  lines,
  cardStatus,
  onNumberClick,
  playerLabel,
  lastCalledNumber,
}) {
  const variant = playerNum === 1 ? "p1" : "p2";
  const title = playerLabel || `PLAYER ${playerNum}`;

  return (
    <div className={`card-section ${variant}-section ${isActive ? "active-card" : "inactive-card"}`}>
      <h3 className="card-label">{title}</h3>
      <div className="card-meta">
        <span className="card-lines">LINES: {lines}/5</span>
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
              {isLastCalled && <span className="cell-last-badge">LAST</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HiddenOpponentCard({ opponentConnected, opponentLabel }) {
  const placeholderCells = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="card-section p2-section inactive-card online-hidden-opponent">
      <h3 className="card-label">{opponentLabel || "OPPONENT CARD"}</h3>
      <div className="card-meta">
        <span className="card-lines">OPPONENT: HIDDEN</span>
        <span className={`card-status ${opponentConnected ? "card-status-wait" : "card-status-lose"}`}>
          {opponentConnected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="bingo-grid p2-grid hidden-card-grid">
        <div className="hidden-card-overlay">
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

export function App() {
  // Theme State ("light" | "dark") - Default to Light Mode
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("bingo_theme") || "light";
  });

  // Keep theme attribute in sync
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bingo_theme", theme);
  }, [theme]);

  // Authentication & User State
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState("signin"); // "signin", "signup"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // App Navigation Screens: "auth", "main_menu", "diff_select", "online_lobby", "friends", "history", "profile", "game"
  const [screen, setScreen] = useState("auth");
  const [gameMode, setGameMode] = useState("ai"); // "ai", "two_player", "online"
  const [difficulty, setDifficulty] = useState("medium");

  // Local Game State
  const [player1Card, setPlayer1Card] = useState(() => createShuffledCard());
  const [player2Card, setPlayer2Card] = useState(() => createShuffledCard());
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastCalledNumber, setLastCalledNumber] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [aiThinking, setAiThinking] = useState(false);

  // Up-to-date state references for timers & AI execution
  const player1CardRef = useRef(player1Card);
  const player2CardRef = useRef(player2Card);
  const calledNumbersRef = useRef(calledNumbers);
  const gameModeRef = useRef(gameMode);
  const difficultyRef = useRef(difficulty);
  const gameOverRef = useRef(gameOver);
  const aiTimerRef = useRef(null);
  const aiWatchdogRef = useRef(null);

  useEffect(() => { player1CardRef.current = player1Card; }, [player1Card]);
  useEffect(() => { player2CardRef.current = player2Card; }, [player2Card]);
  useEffect(() => { calledNumbersRef.current = calledNumbers; }, [calledNumbers]);
  useEffect(() => { gameModeRef.current = gameMode; }, [gameMode]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);

  // Online Multiplayer State
  const [onlinePlayerNum, setOnlinePlayerNum] = useState(1);
  const [onlinePlayer1Name, setOnlinePlayer1Name] = useState("Player 1");
  const [onlinePlayer2Name, setOnlinePlayer2Name] = useState("Player 2");
  const [myOnlineCard, setMyOnlineCard] = useState([]);
  const [opponentOnlineCard, setOpponentOnlineCard] = useState(null);
  const [myOnlineLines, setMyOnlineLines] = useState(0);
  const [opponentOnlineLines, setOpponentOnlineLines] = useState(0);
  const [roomId, setRoomId] = useState("");
  const [onlineLobbyView, setOnlineLobbyView] = useState("menu"); // "menu", "join", "waiting"
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(1);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [onlineResetRequested, setOnlineResetRequested] = useState(false);
  const [onlineOpponentResetRequested, setOnlineOpponentResetRequested] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const [wsStatus, setWsStatus] = useState("disconnected");

  // Friend System State
  const [friendsTab, setFriendsTab] = useState("my_friends"); // "my_friends", "requests", "add"
  const [friendsList, setFriendsList] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendActionMsg, setFriendActionMsg] = useState("");
  const [friendActionError, setFriendActionError] = useState("");
  const [loadingFriends, setLoadingFriends] = useState(false);

  // Incoming Real-time Game Invite Modal
  const [incomingInvite, setIncomingInvite] = useState(null);

  // Match History & Profile State
  const [matchHistory, setMatchHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedMatchDetails, setSelectedMatchDetails] = useState(null);
  const [userStats, setUserStats] = useState({
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    onlineGames: 0,
    onlineWins: 0,
    onlineLosses: 0,
    onlineDraws: 0,
    winRate: "0.0%",
  });

  const clientRef = useRef(null);
  const currentRoomIdRef = useRef("");

  // Clear all pending AI timers on unmount
  useEffect(() => {
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    };
  }, []);

  // Initialize Persistent Authentication on startup
  useEffect(() => {
    let isMounted = true;
    async function initAuth() {
      try {
        const user = await authService.getCurrentUser();
        if (isMounted) {
          if (user) {
            setCurrentUser(user);
            setScreen("main_menu");
          } else {
            setCurrentUser(null);
            setScreen("auth");
          }
        }
      } catch (err) {
        console.warn("Auth initialization note:", err.message);
        if (isMounted) {
          setCurrentUser(null);
          setScreen("auth");
        }
      } finally {
        if (isMounted) setAuthChecking(false);
      }
    }

    initAuth();

    const unsubscribe = authService.subscribeToAuthChanges((user) => {
      if (isMounted) {
        if (user) {
          setCurrentUser(user);
        } else {
          setCurrentUser(null);
          setScreen("auth");
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Sync Stats on user or screen change
  const refreshStats = useCallback(async () => {
    if (!currentUser) return;
    try {
      const stats = await historyService.getUserStats(currentUser.id);
      setUserStats(stats);
    } catch {}
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && (screen === "profile" || screen === "main_menu")) {
      refreshStats();
    }
  }, [currentUser, screen, refreshStats]);

  // Handle Multiplayer Messages
  const handleMultiplayerMessage = useCallback((data) => {
    if (!data) return;

    if (data.type === "connected") {
      setWsStatus("connected");
      return;
    }

    if (data.type === "friend_invite_received") {
      setIncomingInvite({
        inviterId: data.inviterId,
        inviterUsername: data.inviterUsername,
        roomId: data.roomId,
      });
      return;
    }

    if (data.type === "room_created") {
      currentRoomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setOnlinePlayerNum(data.playerNum || 1);
      setOnlinePlayerCount(data.playerCount || 1);
      if (data.player1Username) setOnlinePlayer1Name(data.player1Username);
      const card = data.ownCard || data.myCard || [];
      setMyOnlineCard([...card]);
      setOpponentOnlineCard(null);
      setOnlineError("");
      setOnlineLobbyView("waiting");
      setCalledNumbers([]);
      setLastCalledNumber(null);
      return;
    }

    if (data.type === "room_joined") {
      currentRoomIdRef.current = data.roomId;
      setRoomId(data.roomId);
      setOnlinePlayerNum(data.playerNum || 2);
      if (data.player1Username) setOnlinePlayer1Name(data.player1Username);
      if (data.player2Username) setOnlinePlayer2Name(data.player2Username);
      const card = data.ownCard || data.myCard || [];
      setMyOnlineCard([...card]);
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
      if (data.player1Username) setOnlinePlayer1Name(data.player1Username);
      if (data.player2Username) setOnlinePlayer2Name(data.player2Username);

      const card = data.ownCard || data.myCard;
      if (card && card.length === 25) setMyOnlineCard([...card]);

      if (Array.isArray(data.calledNumbers)) {
        setCalledNumbers([...data.calledNumbers]);
      }
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
        if (oppCard) setOpponentOnlineCard([...oppCard]);
        refreshStats();
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
  }, [onlinePlayerNum, refreshStats]);

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
    setRoomId("");
    currentRoomIdRef.current = "";
    setOnlineLobbyView("menu");
  }, []);

  const connectMultiplayer = useCallback(() => {
    const client = getClient();
    setOnlineError("");
    client.connect();
  }, [getClient]);

  // Auth Action Handlers
  const handleSignUpSubmit = async (e) => {
    e?.preventDefault();
    setAuthError("");
    setAuthSuccess("");

    if (!authUsername.trim()) {
      setAuthError("Username is required.");
      return;
    }
    if (!authEmail.trim()) {
      setAuthError("Email is required.");
      return;
    }
    if (!authPassword) {
      setAuthError("Password is required.");
      return;
    }
    if (authPassword.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    if (authPassword !== authConfirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    setAuthLoading(true);
    try {
      const user = await authService.signUp({
        email: authEmail,
        password: authPassword,
        username: authUsername,
      });
      setCurrentUser(user);
      setScreen("main_menu");
    } catch (err) {
      setAuthError(authService.formatAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignInSubmit = async (e) => {
    e?.preventDefault();
    setAuthError("");
    setAuthSuccess("");

    if (!authEmail.trim()) {
      setAuthError("Email is required.");
      return;
    }
    if (!authPassword) {
      setAuthError("Password is required.");
      return;
    }

    setAuthLoading(true);
    try {
      const user = await authService.signIn({
        email: authEmail,
        password: authPassword,
      });
      setCurrentUser(user);
      setScreen("main_menu");
    } catch (err) {
      setAuthError(authService.formatAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!authEmail.trim()) {
      setAuthError("Please enter your email address to receive reset instructions.");
      return;
    }
    setAuthLoading(true);
    try {
      await authService.resetPassword(authEmail);
      setAuthSuccess("Password reset email sent. Please check your inbox.");
      setAuthError("");
    } catch (err) {
      setAuthError(authService.formatAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePlayAsGuest = () => {
    const guestUser = authService.createGuestUser();
    setCurrentUser(guestUser);
    setScreen("main_menu");
  };

  const handleSignOut = async () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    setAiThinking(false);
    disconnectMultiplayer();
    await authService.signOut(currentUser);
    setCurrentUser(null);
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthUsername("");
    setAuthError("");
    setScreen("auth");
  };

  // Local Match Calculations
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);
  const p1CompletedCells = useMemo(() => getCompletedCellSet(player1Card, calledSet), [player1Card, calledSet]);
  const p2CompletedCells = useMemo(() => getCompletedCellSet(player2Card, calledSet), [player2Card, calledSet]);
  const p1Lines = useMemo(() => countCompletedLines(player1Card, calledSet), [player1Card, calledSet]);
  const p2Lines = useMemo(() => countCompletedLines(player2Card, calledSet), [player2Card, calledSet]);

  const myOnlineCompletedCells = useMemo(() => getCompletedCellSet(myOnlineCard, calledSet), [myOnlineCard, calledSet]);
  const calculatedMyOnlineLines = useMemo(() => countCompletedLines(myOnlineCard, calledSet), [myOnlineCard, calledSet]);
  const opponentOnlineCompletedCells = useMemo(() => opponentOnlineCard ? getCompletedCellSet(opponentOnlineCard, calledSet) : new Set(), [opponentOnlineCard, calledSet]);
  const calculatedOpponentOnlineLines = useMemo(() => opponentOnlineCard ? countCompletedLines(opponentOnlineCard, calledSet) : 0, [opponentOnlineCard, calledSet]);

  const effectiveMyLines = myOnlineLines || calculatedMyOnlineLines;
  const effectiveOppLines = opponentOnlineLines || calculatedOpponentOnlineLines;

  // ==============================================================================
  // AUTHORITATIVE MOVE PROCESSOR & ROBUST AI SCHEDULER
  // ==============================================================================

  const scheduleAiTurn = useCallback((latestCalledNumbers) => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);

    const diff = difficultyRef.current || "medium";
    const delay = diff === "easy" ? 700 : diff === "hard" ? 1150 : 900;

    // Safety watchdog: Guarantees AI will NEVER remain stuck on thinking
    aiWatchdogRef.current = setTimeout(() => {
      if (gameOverRef.current || gameModeRef.current !== "ai") return;
      console.warn("AI Watchdog triggered - forcing AI move");
      const currentSet = new Set(calledNumbersRef.current);
      const avail = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !currentSet.has(n));
      if (avail.length > 0) {
        applyLocalMove(chooseEasyMove(avail), 2);
      } else {
        setAiThinking(false);
      }
    }, 4500);

    aiTimerRef.current = setTimeout(() => {
      if (gameOverRef.current || gameModeRef.current !== "ai") return;

      try {
        const currentSet = new Set(latestCalledNumbers || calledNumbersRef.current);
        const avail = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !currentSet.has(n));

        if (avail.length === 0) {
          setAiThinking(false);
          return;
        }

        let chosenNumber;
        if (diff === "easy") {
          chosenNumber = chooseEasyMove(avail);
        } else if (diff === "hard") {
          chosenNumber = chooseHardMove(avail, player2CardRef.current, player1CardRef.current, currentSet);
        } else {
          chosenNumber = chooseMediumMove(avail, player2CardRef.current, player1CardRef.current, currentSet);
        }

        // Validate selection
        if (!chosenNumber || currentSet.has(chosenNumber) || !avail.includes(chosenNumber)) {
          console.warn("AI returned invalid choice, using safe random fallback:", chosenNumber);
          chosenNumber = chooseEasyMove(avail);
        }

        if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
        applyLocalMove(chosenNumber, 2);
      } catch (err) {
        console.error("Error during AI turn execution:", err);
        const currentSet = new Set(calledNumbersRef.current);
        const avail = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !currentSet.has(n));
        if (avail.length > 0) {
          applyLocalMove(chooseEasyMove(avail), 2);
        } else {
          setAiThinking(false);
        }
      }
    }, delay);
  }, []);

  const applyLocalMove = useCallback((number, sourcePlayerNum) => {
    if (gameOverRef.current) return;
    if (calledNumbersRef.current.includes(number)) return;

    const nextCalled = [...calledNumbersRef.current, number];
    const nextCalledSet = new Set(nextCalled);
    const newP1Lines = countCompletedLines(player1CardRef.current, nextCalledSet);
    const newP2Lines = countCompletedLines(player2CardRef.current, nextCalledSet);

    setCalledNumbers(nextCalled);
    setLastCalledNumber(number);

    const result = resolveGameResult(newP1Lines, newP2Lines, nextCalled.length);

    if (result !== null) {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
      setGameOver(true);
      setWinner(result);
      setAiThinking(false);

      if (currentUser) {
        historyService.recordLocalGameResult(
          currentUser.id,
          gameModeRef.current,
          result === "player1" ? "win" : result === "player2" ? "loss" : "draw"
        );
        refreshStats();
      }
    } else {
      if (gameModeRef.current === "ai") {
        if (sourcePlayerNum === 1) {
          // Human finished move -> switch to AI and schedule AI response
          setCurrentPlayer(2);
          setAiThinking(true);
          scheduleAiTurn(nextCalled);
        } else {
          // AI finished move -> switch back to Human
          setCurrentPlayer(1);
          setAiThinking(false);
        }
      } else {
        // Two player local mode
        setCurrentPlayer((prev) => (prev === 1 ? 2 : 1));
      }
    }
  }, [currentUser, refreshStats, scheduleAiTurn]);

  const handleNumberClick = (playerNum, number) => {
    if (gameMode === "online") {
      if (gameOver) return;
      if (currentPlayer !== onlinePlayerNum) return;
      if (calledSet.has(number)) return;

      setCalledNumbers((prev) => (prev.includes(number) ? prev : [...prev, number]));
      setLastCalledNumber(number);

      getClient().selectNumber(number);
      return;
    }

    if (gameOver || aiThinking) return;
    if (gameMode === "ai" && currentPlayer !== 1) return;
    if (gameMode === "two_player" && currentPlayer !== playerNum) return;
    if (calledSet.has(number)) return;

    applyLocalMove(number, playerNum);
  };

  // Reset and Local Game Initialization
  const resetLocalGameState = () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    setPlayer1Card(createShuffledCard());
    setPlayer2Card(createShuffledCard());
    setCalledNumbers([]);
    setLastCalledNumber(null);
    setCurrentPlayer(1);
    setGameOver(false);
    setWinner(null);
    setAiThinking(false);
  };

  const startNewLocalGame = (mode) => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    setGameMode(mode);
    resetLocalGameState();
    setScreen("game");
  };

  const handleCreateOnlineGame = () => {
    const client = getClient();
    setOnlineError("");
    client.createRoom(currentUser);
  };

  const handleJoinOnlineGame = () => {
    const cleanCode = joinCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setOnlineError("Please enter a game code.");
      return;
    }
    const client = getClient();
    setOnlineError("");
    client.joinRoom(cleanCode, currentUser);
  };

  const handleCopyRoomCode = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const handleLeaveOnlineGame = () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    setAiThinking(false);
    disconnectMultiplayer();
    setScreen("main_menu");
  };

  const handleRequestOnlineReset = () => {
    setOnlineResetRequested(true);
    getClient().requestRestart();
  };

  // Friend System Actions
  const loadFriendsData = async () => {
    if (!currentUser || currentUser.isGuest) return;
    setLoadingFriends(true);
    setFriendActionMsg("");
    setFriendActionError("");
    try {
      const [friends, requests] = await Promise.all([
        friendService.getFriends(currentUser.id),
        friendService.getFriendRequests(currentUser.id),
      ]);
      setFriendsList(friends);
      setFriendRequests(requests);
    } catch (err) {
      setFriendActionError("Could not load friends: " + err.message);
    } finally {
      setLoadingFriends(false);
    }
  };

  const handleSearchUsers = async () => {
    if (!friendSearchQuery.trim()) return;
    setLoadingFriends(true);
    setFriendActionError("");
    setFriendActionMsg("");
    try {
      const results = await friendService.searchUsers(friendSearchQuery, currentUser?.id);
      setFriendSearchResults(results);
      if (results.length === 0) setFriendActionMsg("USER NOT FOUND");
    } catch (err) {
      setFriendActionError(err.message || "Failed to search users.");
    } finally {
      setLoadingFriends(false);
    }
  };

  const handleSendFriendRequest = async (receiverId) => {
    setFriendActionError("");
    setFriendActionMsg("");
    try {
      await friendService.sendFriendRequest(currentUser.id, receiverId);
      setFriendActionMsg("Friend request sent successfully.");
      loadFriendsData();
    } catch (err) {
      setFriendActionError(err.message || "Could not send friend request.");
    }
  };

  const handleRespondFriendRequest = async (requestId, accept, senderId) => {
    try {
      await friendService.respondToFriendRequest(requestId, accept, senderId, currentUser.id);
      loadFriendsData();
    } catch (err) {
      setFriendActionError("Action failed: " + err.message);
    }
  };

  const handleRemoveFriend = async (friendId) => {
    try {
      await friendService.removeFriend(currentUser.id, friendId);
      loadFriendsData();
    } catch (err) {
      setFriendActionError("Failed to remove friend: " + err.message);
    }
  };

  const handleInviteFriendToGame = (friend) => {
    setGameMode("online");
    const client = getClient();
    client.createRoom(currentUser);
    setTimeout(() => {
      if (client.roomId && client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: "friend_invite",
            targetUserId: friend.id,
            inviterId: currentUser.id,
            inviterUsername: currentUser.username,
            roomId: client.roomId,
          })
        );
      }
    }, 400);
    setScreen("online_lobby");
    setOnlineLobbyView("waiting");
  };

  const handleAcceptInvite = () => {
    if (!incomingInvite) return;
    const roomCode = incomingInvite.roomId;
    setIncomingInvite(null);
    setGameMode("online");
    const client = getClient();
    client.joinRoom(roomCode, currentUser);
  };

  const handleDeclineInvite = () => {
    setIncomingInvite(null);
  };

  // Match History Loader
  const loadMatchHistoryData = async () => {
    if (!currentUser) return;
    setLoadingHistory(true);
    try {
      const history = await historyService.getMatchHistory(currentUser.id);
      setMatchHistory(history);
    } catch (err) {
      console.warn("Could not load history:", err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  // UI Text Helpers
  const getTurnIndicatorText = () => {
    if (gameOver) return "";
    if (gameMode === "online") {
      if (!opponentConnected) return "OPPONENT DISCONNECTED";
      const oppName = onlinePlayerNum === 1 ? onlinePlayer2Name : onlinePlayer1Name;
      return currentPlayer === onlinePlayerNum ? "YOUR TURN" : `${oppName.toUpperCase()}'S TURN`;
    }
    if (gameMode === "ai") return currentPlayer === 1 ? "YOUR TURN" : "AI IS THINKING...";
    return currentPlayer === 1 ? "PLAYER 1'S TURN" : "PLAYER 2'S TURN";
  };

  const getBingoMessage = () => {
    if (gameMode === "online") {
      if (winner === "player1") return onlinePlayerNum === 1 ? "BINGO! YOU WIN!" : `BINGO! ${onlinePlayer1Name.toUpperCase()} WINS!`;
      if (winner === "player2") return onlinePlayerNum === 2 ? "BINGO! YOU WIN!" : `BINGO! ${onlinePlayer2Name.toUpperCase()} WINS!`;
      if (winner === "draw") return "DRAW!";
      return null;
    }
    if (winner === "player1") return gameMode === "ai" ? "BINGO! YOU WIN!" : "BINGO! PLAYER 1 WINS!";
    if (winner === "player2") return gameMode === "ai" ? "BINGO! AI WINS!" : "BINGO! PLAYER 2 WINS!";
    if (winner === "draw") return "DRAW!";
    return null;
  };

  const getGameStatusText = () => {
    if (gameOver) {
      if (winner === "draw") return "Draw";
      if (gameMode === "online") return winner === `player${onlinePlayerNum}` ? "You Won!" : "You Lost";
      if (gameMode === "ai") return winner === "player1" ? "You Won!" : "AI Won";
      return winner === "player1" ? "Player 1 Won" : "Player 2 Won";
    }
    return "In Progress";
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

  const wsStatusLabel = wsStatus === "connecting" ? "CONNECTING" : wsStatus === "connected" ? "CONNECTED" : "DISCONNECTED";
  const wsStatusClass = wsStatus === "connecting" ? "conn-connecting" : wsStatus === "connected" ? "conn-online" : "conn-offline";

  // --- SCREEN 0: LOADING ACCOUNT STATE (Prevents flash of login screen) ---
  if (authChecking) {
    return (
      <div className="bingo-app loading-screen">
        <h1 className="title">BINGO</h1>
        <div className="loading-card">
          <div className="spinner-large"></div>
          <div className="loading-text">LOADING ACCOUNT...</div>
        </div>
      </div>
    );
  }

  // --- SCREEN 1: AUTHENTICATION ---
  if (screen === "auth") {
    return (
      <div className="bingo-app auth-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">Real-time Multiplayer & Match Tracking</p>

        <div className="auth-card">
          <div className="auth-tabs">
            <button
              className={`auth-tab-btn ${authMode === "signin" ? "active" : ""}`}
              onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSuccess(""); }}
            >
              SIGN IN
            </button>
            <button
              className={`auth-tab-btn ${authMode === "signup" ? "active" : ""}`}
              onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthSuccess(""); }}
            >
              SIGN UP
            </button>
          </div>

          {authError && <div className="auth-alert error">{authError}</div>}
          {authSuccess && <div className="auth-alert success">{authSuccess}</div>}

          {authMode === "signin" && (
            <form className="auth-form" onSubmit={handleSignInSubmit}>
              <div className="form-group">
                <label className="form-label">EMAIL</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Enter your email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">PASSWORD</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter your password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-auth-primary" disabled={authLoading}>
                {authLoading ? "SIGNING IN..." : "SIGN IN"}
              </button>
              <button type="button" className="btn-link" onClick={handleForgotPassword} disabled={authLoading}>
                FORGOT PASSWORD
              </button>
            </form>
          )}

          {authMode === "signup" && (
            <form className="auth-form" onSubmit={handleSignUpSubmit}>
              <div className="form-group">
                <label className="form-label">USERNAME</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Choose a unique username"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">EMAIL</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Enter your email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">PASSWORD</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Create a secure password (min 6 chars)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">CONFIRM PASSWORD</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Re-enter your password"
                  value={authConfirmPassword}
                  onChange={(e) => setAuthConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-auth-primary" disabled={authLoading}>
                {authLoading ? "CREATING ACCOUNT..." : "SIGN UP"}
              </button>
            </form>
          )}

          <div className="auth-divider">
            <span>OR</span>
          </div>

          <button className="btn btn-guest" onClick={handlePlayAsGuest} disabled={authLoading}>
            PLAY AS GUEST
          </button>
          <div className="guest-note">
            Guest mode lets you play immediately. Online stats and friendships are preserved permanently for registered accounts.
          </div>
        </div>
      </div>
    );
  }

  // --- SCREEN 2: MAIN MENU ---
  if (screen === "main_menu") {
    return (
      <div className="bingo-app main-menu-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="welcome-tag">
          Welcome, <strong>{currentUser?.username || "Player"}</strong>
          {currentUser?.isGuest && <span className="guest-badge">Guest Mode</span>}
        </p>

        <div className="main-menu-grid">
          <button className="menu-btn primary-menu-btn" onClick={() => setScreen("diff_select")}>
            <div className="menu-btn-title">PLAY AGAINST AI</div>
            <div className="menu-btn-desc">Challenge the computer across 3 difficulty levels</div>
          </button>

          <button className="menu-btn primary-menu-btn" onClick={() => startNewLocalGame("two_player")}>
            <div className="menu-btn-title">TWO PLAYER</div>
            <div className="menu-btn-desc">Play locally with a friend on the same device</div>
          </button>

          <button className="menu-btn primary-menu-btn" onClick={() => { setGameMode("online"); connectMultiplayer(); setScreen("online_lobby"); }}>
            <div className="menu-btn-title">ONLINE MODE</div>
            <div className="menu-btn-desc">Play real-time multiplayer with a private card</div>
          </button>

          <button className="menu-btn secondary-menu-btn" onClick={() => { setScreen("friends"); loadFriendsData(); }}>
            <div className="menu-btn-title">FRIENDS</div>
            <div className="menu-btn-desc">Manage friends, presence, and send game invites</div>
          </button>

          <button className="menu-btn secondary-menu-btn" onClick={() => { setScreen("history"); loadMatchHistoryData(); }}>
            <div className="menu-btn-title">ONLINE HISTORY</div>
            <div className="menu-btn-desc">View completed multiplayer matches and game breakdown</div>
          </button>

          <button className="menu-btn secondary-menu-btn" onClick={() => { setScreen("profile"); refreshStats(); }}>
            <div className="menu-btn-title">PROFILE</div>
            <div className="menu-btn-desc">Check your win rate and online gameplay statistics</div>
          </button>
        </div>

        <button className="btn btn-signout" onClick={handleSignOut}>
          SIGN OUT
        </button>
      </div>
    );
  }

  // --- SCREEN 3: PROFILE & STATISTICS ---
  if (screen === "profile") {
    return (
      <div className="bingo-app profile-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">USER PROFILE & STATISTICS</p>

        <div className="profile-container">
          <div className="profile-header-card">
            <div className="profile-avatar-circle">
              {currentUser?.username?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="profile-header-info">
              <h2 className="profile-username">{currentUser?.username}</h2>
              <span className="profile-account-type">
                {currentUser?.isGuest ? "GUEST ACCOUNT" : "REGISTERED MEMBER"}
              </span>
              {currentUser?.email && <span className="profile-email">{currentUser.email}</span>}
            </div>
          </div>

          <div className="stats-section-title">ALL-TIME STATS</div>
          <div className="stats-grid-card">
            <div className="stat-box">
              <span className="stat-label">GAMES PLAYED</span>
              <span className="stat-value">{userStats.gamesPlayed}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">WINS</span>
              <span className="stat-value win-color">{userStats.wins}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">LOSSES</span>
              <span className="stat-value loss-color">{userStats.losses}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">DRAWS</span>
              <span className="stat-value draw-color">{userStats.draws}</span>
            </div>
          </div>

          <div className="stats-section-title">ONLINE MULTIPLAYER STATS</div>
          <div className="stats-grid-card">
            <div className="stat-box">
              <span className="stat-label">ONLINE GAMES</span>
              <span className="stat-value">{userStats.onlineGames}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">ONLINE WINS</span>
              <span className="stat-value win-color">{userStats.onlineWins}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">ONLINE LOSSES</span>
              <span className="stat-value loss-color">{userStats.onlineLosses}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">ONLINE DRAWS</span>
              <span className="stat-value draw-color">{userStats.onlineDraws}</span>
            </div>
            <div className="stat-box highlight-box">
              <span className="stat-label">WIN RATE</span>
              <span className="stat-value highlight-value">{userStats.winRate}</span>
            </div>
          </div>

          <button className="btn btn-back" onClick={() => setScreen("main_menu")}>
            BACK TO MENU
          </button>
        </div>
      </div>
    );
  }

  // --- SCREEN 4: FRIENDS SYSTEM ---
  if (screen === "friends") {
    return (
      <div className="bingo-app friends-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">FRIEND SYSTEM</p>

        <div className="friends-container">
          <div className="friends-nav-tabs">
            <button
              className={`friends-tab-btn ${friendsTab === "my_friends" ? "active" : ""}`}
              onClick={() => { setFriendsTab("my_friends"); loadFriendsData(); }}
            >
              MY FRIENDS ({friendsList.length})
            </button>
            <button
              className={`friends-tab-btn ${friendsTab === "requests" ? "active" : ""}`}
              onClick={() => { setFriendsTab("requests"); loadFriendsData(); }}
            >
              REQUESTS ({friendRequests.length})
            </button>
            <button
              className={`friends-tab-btn ${friendsTab === "add" ? "active" : ""}`}
              onClick={() => { setFriendsTab("add"); setFriendSearchResults([]); }}
            >
              ADD FRIEND
            </button>
          </div>

          {friendActionMsg && <div className="friend-banner success">{friendActionMsg}</div>}
          {friendActionError && <div className="friend-banner error">{friendActionError}</div>}

          {currentUser?.isGuest && (
            <div className="guest-warning-banner">
              You are currently in Guest mode. Sign in to send persistent friend requests and invite friends.
            </div>
          )}

          {friendsTab === "my_friends" && (
            <div className="friends-tab-content">
              {loadingFriends ? (
                <div className="loading-spinner">Loading friends...</div>
              ) : friendsList.length === 0 ? (
                <div className="empty-friends-state">
                  No friends added yet. Use "ADD FRIEND" to search and connect with players!
                </div>
              ) : (
                <div className="friends-list-grid">
                  {friendsList.map((friend) => (
                    <div key={friend.id} className="friend-item-card">
                      <div className="friend-info">
                        <span className="friend-name">{friend.username}</span>
                        <span className={`presence-pill ${friend.onlineStatus}`}>
                          {friend.onlineStatus.toUpperCase()}
                        </span>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="btn btn-invite-friend"
                          onClick={() => handleInviteFriendToGame(friend)}
                          disabled={currentUser?.isGuest}
                        >
                          INVITE TO GAME
                        </button>
                        <button
                          className="btn btn-remove-friend"
                          onClick={() => handleRemoveFriend(friend.id)}
                        >
                          REMOVE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {friendsTab === "requests" && (
            <div className="friends-tab-content">
              {loadingFriends ? (
                <div className="loading-spinner">Loading requests...</div>
              ) : friendRequests.length === 0 ? (
                <div className="empty-friends-state">No pending friend requests.</div>
              ) : (
                <div className="friend-requests-list">
                  {friendRequests.map((req) => (
                    <div key={req.id} className="friend-request-card">
                      <div className="request-user-info">
                        <span className="request-username">{req.username}</span>
                        <span className="request-label">Wants to be your friend</span>
                      </div>
                      <div className="request-btn-group">
                        <button
                          className="btn btn-accept"
                          onClick={() => handleRespondFriendRequest(req.id, true, req.senderId)}
                        >
                          ACCEPT
                        </button>
                        <button
                          className="btn btn-decline"
                          onClick={() => handleRespondFriendRequest(req.id, false, req.senderId)}
                        >
                          DECLINE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {friendsTab === "add" && (
            <div className="friends-tab-content">
              <div className="add-friend-search-box">
                <input
                  type="text"
                  className="friend-search-input"
                  placeholder="Search user by username"
                  value={friendSearchQuery}
                  onChange={(e) => setFriendSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchUsers()}
                />
                <button className="btn btn-search" onClick={handleSearchUsers} disabled={loadingFriends}>
                  {loadingFriends ? "SEARCHING..." : "SEARCH"}
                </button>
              </div>

              <div className="search-results-list">
                {friendSearchResults.map((user) => (
                  <div key={user.id} className="search-result-card">
                    <div className="result-user-info">
                      <span className="result-username">{user.username}</span>
                      <span className="result-status">{user.online_status?.toUpperCase() || "OFFLINE"}</span>
                    </div>
                    <button
                      className="btn btn-send-request"
                      onClick={() => handleSendFriendRequest(user.id)}
                      disabled={currentUser?.isGuest}
                    >
                      SEND REQUEST
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-back" onClick={() => setScreen("main_menu")}>
            BACK TO MENU
          </button>
        </div>
      </div>
    );
  }

  // --- SCREEN 5: ONLINE MATCH HISTORY ---
  if (screen === "history") {
    return (
      <div className="bingo-app history-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">ONLINE MATCH HISTORY</p>

        <div className="history-container">
          {loadingHistory ? (
            <div className="loading-spinner">Loading match history...</div>
          ) : matchHistory.length === 0 ? (
            <div className="empty-history-card">
              No online match records found yet. Play in Online Mode to automatically record match stats!
            </div>
          ) : (
            <div className="history-matches-list">
              {matchHistory.map((m) => (
                <div
                  key={m.id}
                  className={`history-match-item outcome-${m.result.toLowerCase()}`}
                  onClick={() => setSelectedMatchDetails(m)}
                >
                  <div className="history-col date-col">{m.date}</div>
                  <div className="history-col opponent-col">
                    <span className="col-sublabel">OPPONENT</span>
                    <span className="col-value">{m.opponentUsername}</span>
                  </div>
                  <div className="history-col result-col">
                    <span className={`result-badge ${m.result.toLowerCase()}`}>{m.result}</span>
                  </div>
                  <div className="history-col score-col">
                    <span className="col-sublabel">LINES</span>
                    <span className="col-value">{m.myLines} - {m.opponentLines}</span>
                  </div>
                  <div className="history-col action-col">
                    <button className="btn btn-details-sm">DETAILS</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-back" onClick={() => setScreen("main_menu")}>
            BACK TO MENU
          </button>
        </div>

        {selectedMatchDetails && (
          <div className="modal-backdrop" onClick={() => setSelectedMatchDetails(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">MATCH DETAILS</h3>
              <div className="modal-meta-grid">
                <div className="meta-row">
                  <span className="meta-label">OPPONENT:</span>
                  <span className="meta-val">{selectedMatchDetails.opponentUsername}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">DATE:</span>
                  <span className="meta-val">{selectedMatchDetails.date}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">RESULT:</span>
                  <span className={`meta-val result-badge ${selectedMatchDetails.result.toLowerCase()}`}>
                    {selectedMatchDetails.result}
                  </span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">YOUR FINAL LINES:</span>
                  <span className="meta-val">{selectedMatchDetails.myLines} / 5</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">OPPONENT LINES:</span>
                  <span className="meta-val">{selectedMatchDetails.opponentLines} / 5</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">TOTAL NUMBERS CALLED:</span>
                  <span className="meta-val">{selectedMatchDetails.totalCalled}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">LAST CALLED NUMBER:</span>
                  <span className="meta-val">{selectedMatchDetails.lastCalledNumber || "-"}</span>
                </div>
              </div>
              <button className="btn btn-modal-close" onClick={() => setSelectedMatchDetails(null)}>
                CLOSE
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- SCREEN 6: DIFFICULTY SELECT ---
  if (screen === "diff_select") {
    return (
      <div className="bingo-app mode-selection-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">CHOOSE DIFFICULTY</p>
        <div className="diff-selection-container">
          <button className="diff-card diff-easy" onClick={() => { setDifficulty("easy"); startNewLocalGame("ai"); }}>
            <div className="diff-badge">EASY</div>
            <div className="diff-desc">AI chooses randomly and makes simple decisions.</div>
          </button>
          <button className="diff-card diff-medium" onClick={() => { setDifficulty("medium"); startNewLocalGame("ai"); }}>
            <div className="diff-badge">MEDIUM</div>
            <div className="diff-desc">AI tries to complete its own lines while occasionally blocking you.</div>
          </button>
          <button className="diff-card diff-hard" onClick={() => { setDifficulty("hard"); startNewLocalGame("ai"); }}>
            <div className="diff-badge">HARD</div>
            <div className="diff-desc">AI intelligently prioritizes winning and blocking your strongest moves.</div>
          </button>
        </div>
        <button className="btn btn-back" onClick={() => setScreen("main_menu")}>
          BACK TO MENU
        </button>
      </div>
    );
  }

  // --- SCREEN 7: ONLINE LOBBY ---
  if (screen === "online_lobby") {
    return (
      <div className="bingo-app mode-selection-page">
        <div className="top-header-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <h1 className="title">BINGO</h1>
        <p className="subtitle">ONLINE BINGO</p>

        <div className="online-status-bar">
          <span className={`ws-status-badge ${wsStatusClass}`}>{wsStatusLabel}</span>
          <span className="ws-debug-info">
            Multiplayer Engine: <code>{activeWsUrl => activeWsUrl ? `WebSocket (${activeWsUrl})` : "WebRTC P2P (100% Free - Serverless)"}</code>
          </span>
        </div>

        {onlineError && (
          <div className="online-error-banner">
            <div>{onlineError}</div>
            {wsStatus === "disconnected" && (
              <button className="btn btn-retry" onClick={() => connectMultiplayer()}>
                RETRY CONNECTION
              </button>
            )}
          </div>
        )}

        {onlineLobbyView === "menu" && (
          <div className="online-lobby-menu">
            <div className="lobby-options-container">
              <button className="lobby-action-card create-card" onClick={handleCreateOnlineGame}>
                <div className="lobby-card-title">CREATE GAME</div>
                <div className="lobby-card-desc">
                  {wsStatus === "connecting" ? "Connecting..." : "Generate a 6-digit room code and wait for a friend"}
                </div>
              </button>
              <button className="lobby-action-card join-card" onClick={() => setOnlineLobbyView("join")}>
                <div className="lobby-card-title">JOIN GAME</div>
                <div className="lobby-card-desc">Enter an existing room code to play immediately</div>
              </button>
            </div>
            <button className="btn btn-back" onClick={() => { disconnectMultiplayer(); setScreen("main_menu"); }}>
              BACK TO MENU
            </button>
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
                <button className="btn btn-back" onClick={() => setOnlineLobbyView("menu")}>
                  BACK
                </button>
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
                {copiedCode ? "COPIED!" : "COPY CODE"}
              </button>
              <div className="waiting-status-text">
                <span className="spinner-dot"></span> Waiting for opponent to join...
              </div>
              <button className="btn btn-leave-lobby" onClick={handleLeaveOnlineGame}>
                LEAVE GAME
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- SCREEN 8: IN-GAME PLAY ---
  const bingoMsg = getBingoMessage();
  const myPlayerName = currentUser?.username || "You";
  const opponentName = gameMode === "online" ? (onlinePlayerNum === 1 ? onlinePlayer2Name : onlinePlayer1Name) : gameMode === "ai" ? "AI" : "Player 2";

  return (
    <div className="bingo-app">
      <div className="top-header-bar">
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>

      <h1 className="title">BINGO</h1>

      {gameMode === "ai" && (
        <div className={`difficulty-banner diff-tag-${difficulty}`}>
          AI DIFFICULTY: {difficulty.toUpperCase()}
        </div>
      )}

      {gameMode === "online" && (
        <div className="online-room-banner">
          <span className="online-tag">ONLINE MODE</span>
          <span className="room-badge">ROOM: {roomId}</span>
          <span className={`conn-tag ${wsStatusClass}`}>{wsStatusLabel}</span>
          <span className={`conn-tag ${opponentConnected ? "conn-online" : "conn-offline"}`}>
            Opponent: {opponentConnected ? "Online" : "Disconnected"}
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
            {lastCalledNumber !== null ? lastCalledNumber : "-"}
          </span>
        </div>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">{gameMode === "online" ? `${myPlayerName}'s Lines` : "Player 1 Lines"}</span>
            <span className="status-value p1-lines">{gameMode === "online" ? `${effectiveMyLines}/5` : `${p1Lines}/5`}</span>
          </div>
          <div className="status-item">
            <span className="status-label">{gameMode === "online" ? `${opponentName}'s Lines` : gameMode === "ai" ? "AI Lines" : "Player 2 Lines"}</span>
            <span className="status-value p2-lines">
              {gameMode === "online" ? (gameOver && opponentOnlineCard ? `${effectiveOppLines}/5` : "Hidden") : `${p2Lines}/5`}
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
        <div className="called-history">
          <div className="called-history-header">
            <span className="status-label">CALLED NUMBERS ({calledNumbers.length}/25):</span>
          </div>
          <div className="called-history-list">
            {calledNumbers.length === 0 ? (
              <span className="called-history-empty">No numbers called yet. Start by picking a number on your turn!</span>
            ) : (
              calledNumbers.map((n, i) => (
                <span
                  key={i}
                  className={`called-history-chip ${n === lastCalledNumber ? "latest-chip" : ""}`}
                >
                  {n}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="cards-container">
        {gameMode === "online" ? (
          <>
            <div className={`card-section ${onlinePlayerNum === 1 ? "p1-section" : "p2-section"} active-card`}>
              <h3 className="card-label">YOUR CARD ({myPlayerName.toUpperCase()})</h3>
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
                      {isLastCalled && <span className="cell-last-badge">LAST</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {gameOver && opponentOnlineCard ? (
              <div className={`card-section ${onlinePlayerNum === 1 ? "p2-section" : "p1-section"} active-card reveal-opponent-card`}>
                <h3 className="card-label">{opponentName.toUpperCase()}'S FINAL CARD</h3>
                <div className="card-meta">
                  <span className="card-lines">{opponentName.toUpperCase()} LINES: {effectiveOppLines}/5</span>
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <HiddenOpponentCard opponentConnected={opponentConnected} opponentLabel={`${opponentName.toUpperCase()}'S CARD`} />
            )}
          </>
        ) : (
          <>
            <BingoCard
              card={player1Card}
              calledSet={calledSet}
              completedCellSet={p1CompletedCells}
              playerNum={1}
              playerLabel={gameMode === "ai" ? "YOUR CARD" : "PLAYER 1"}
              isActive={!gameOver && currentPlayer === 1 && !aiThinking}
              lines={p1Lines}
              cardStatus={getCardStatus(1)}
              onNumberClick={(num) => handleNumberClick(1, num)}
              lastCalledNumber={lastCalledNumber}
            />
            <BingoCard
              card={player2Card}
              calledSet={calledSet}
              completedCellSet={p2CompletedCells}
              playerNum={2}
              playerLabel={gameMode === "ai" ? "AI CARD" : "PLAYER 2"}
              isActive={!gameOver && currentPlayer === 2 && gameMode === "two_player"}
              lines={p2Lines}
              cardStatus={getCardStatus(2)}
              onNumberClick={(num) => handleNumberClick(2, num)}
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
              {onlineResetRequested ? "WAITING FOR OPPONENT..." : onlineOpponentResetRequested ? "ACCEPT NEW GAME" : "REQUEST NEW GAME"}
            </button>
            <button className="btn btn-leave" onClick={handleLeaveOnlineGame}>
              LEAVE GAME
            </button>
            <button className="btn btn-mode" onClick={() => { disconnectMultiplayer(); setScreen("main_menu"); }}>
              MAIN MENU
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-reset" onClick={resetLocalGameState}>
              RESET GAME
            </button>
            {gameMode === "ai" && (
              <button className="btn btn-diff" onClick={() => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current); setAiThinking(false); setScreen("diff_select"); }}>
                CHANGE DIFFICULTY
              </button>
            )}
            <button className="btn btn-mode" onClick={() => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current); setAiThinking(false); setScreen("main_menu"); }}>
              MAIN MENU
            </button>
          </>
        )}
      </div>

      {/* Real-time Friend Game Invitation Modal */}
      {incomingInvite && (
        <div className="invite-modal-overlay">
          <div className="invite-modal-card">
            <h3 className="invite-modal-title">GAME INVITATION</h3>
            <p className="invite-modal-desc">
              <strong>{incomingInvite.inviterUsername}</strong> has invited you to play Bingo!
            </p>
            <div className="invite-modal-actions">
              <button className="btn btn-accept" onClick={handleAcceptInvite}>
                ACCEPT
              </button>
              <button className="btn btn-decline" onClick={handleDeclineInvite}>
                DECLINE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
