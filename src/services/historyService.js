import { supabase, isSupabaseConfigured } from "./supabase";

const LOCAL_STORAGE_MATCHES_KEY = "bingo_local_matches";
const LOCAL_STORAGE_STATS_KEY = "bingo_local_stats";

function getLocalMatches(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_STORAGE_MATCHES_KEY) || "{}");
    return all[userId] || [];
  } catch {
    return [];
  }
}

function saveLocalMatches(userId, matches) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_STORAGE_MATCHES_KEY) || "{}");
    all[userId] = matches;
    localStorage.setItem(LOCAL_STORAGE_MATCHES_KEY, JSON.stringify(all));
  } catch {}
}

export function getLocalStats(userId) {
  try {
    const allStats = JSON.parse(localStorage.getItem(LOCAL_STORAGE_STATS_KEY) || "{}");
    return (
      allStats[userId] || {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        onlineGames: 0,
        onlineWins: 0,
        onlineLosses: 0,
        onlineDraws: 0,
      }
    );
  } catch {
    return {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      onlineGames: 0,
      onlineWins: 0,
      onlineLosses: 0,
      onlineDraws: 0,
    };
  }
}

export function recordLocalGameResult(userId, gameMode, result) {
  // result: "win", "loss", "draw"
  if (!userId) return;
  const stats = getLocalStats(userId);
  stats.gamesPlayed += 1;
  if (result === "win") stats.wins += 1;
  else if (result === "loss") stats.losses += 1;
  else if (result === "draw") stats.draws += 1;

  if (gameMode === "online") {
    stats.onlineGames += 1;
    if (result === "win") stats.onlineWins += 1;
    else if (result === "loss") stats.onlineLosses += 1;
    else if (result === "draw") stats.onlineDraws += 1;
  }

  const allStats = JSON.parse(localStorage.getItem(LOCAL_STORAGE_STATS_KEY) || "{}");
  allStats[userId] = stats;
  localStorage.setItem(LOCAL_STORAGE_STATS_KEY, JSON.stringify(allStats));
}

export async function recordOnlineMatch(matchData) {
  const {
    roomId,
    player1Id,
    player2Id,
    player1Username,
    player2Username,
    winnerId,
    result, // 'player1', 'player2', 'draw'
    player1Lines,
    player2Lines,
    calledNumbers,
    lastCalledNumber,
    startedAt,
    endedAt,
  } = matchData;

  const totalCalled = Array.isArray(calledNumbers) ? calledNumbers.length : 0;

  // 1. Record to Supabase if configured
  if (isSupabaseConfigured) {
    try {
      await supabase.from("online_matches").insert({
        room_id: roomId,
        player1_id: player1Id && !player1Id.startsWith("guest_") ? player1Id : null,
        player2_id: player2Id && !player2Id.startsWith("guest_") ? player2Id : null,
        player1_username: player1Username || "Player 1",
        player2_username: player2Username || "Player 2",
        winner_id: winnerId && !winnerId.startsWith("guest_") ? winnerId : null,
        result,
        player1_lines: player1Lines || 0,
        player2_lines: player2Lines || 0,
        called_numbers: calledNumbers || [],
        last_called_number: lastCalledNumber,
        total_called: totalCalled,
        started_at: startedAt || new Date().toISOString(),
        ended_at: endedAt || new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Could not insert online match to Supabase:", e.message);
    }
  }

  // 2. Always store in local history for both players
  const formattedRecordP1 = {
    id: "match_" + Date.now() + "_1",
    roomId,
    opponentUsername: player2Username || "Player 2",
    result: result === "player1" ? "WIN" : result === "player2" ? "LOSS" : "DRAW",
    myLines: player1Lines || 0,
    opponentLines: player2Lines || 0,
    calledNumbers: calledNumbers || [],
    totalCalled,
    lastCalledNumber,
    date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    timestamp: new Date().toISOString(),
  };

  const formattedRecordP2 = {
    id: "match_" + Date.now() + "_2",
    roomId,
    opponentUsername: player1Username || "Player 1",
    result: result === "player2" ? "WIN" : result === "player1" ? "LOSS" : "DRAW",
    myLines: player2Lines || 0,
    opponentLines: player1Lines || 0,
    calledNumbers: calledNumbers || [],
    totalCalled,
    lastCalledNumber,
    date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    timestamp: new Date().toISOString(),
  };

  if (player1Id) {
    const p1Matches = getLocalMatches(player1Id);
    p1Matches.unshift(formattedRecordP1);
    saveLocalMatches(player1Id, p1Matches.slice(0, 50));
    recordLocalGameResult(player1Id, "online", formattedRecordP1.result.toLowerCase());
  }

  if (player2Id) {
    const p2Matches = getLocalMatches(player2Id);
    p2Matches.unshift(formattedRecordP2);
    saveLocalMatches(player2Id, p2Matches.slice(0, 50));
    recordLocalGameResult(player2Id, "online", formattedRecordP2.result.toLowerCase());
  }
}

export async function getMatchHistory(userId, limit = 20) {
  if (isSupabaseConfigured && userId && !userId.startsWith("guest_") && !userId.startsWith("user_")) {
    try {
      const { data, error } = await supabase
        .from("online_matches")
        .select("*")
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .order("ended_at", { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) {
        return data.map((m) => {
          const isP1 = m.player1_id === userId;
          let outcome = "DRAW";
          if (m.result === "player1") outcome = isP1 ? "WIN" : "LOSS";
          else if (m.result === "player2") outcome = isP1 ? "LOSS" : "WIN";

          const formattedDate = new Date(m.ended_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });

          return {
            id: m.id,
            roomId: m.room_id,
            opponentUsername: isP1 ? m.player2_username : m.player1_username,
            result: outcome,
            myLines: isP1 ? m.player1_lines : m.player2_lines,
            opponentLines: isP1 ? m.player2_lines : m.player1_lines,
            calledNumbers: Array.isArray(m.called_numbers) ? m.called_numbers : [],
            totalCalled: m.total_called || (m.called_numbers ? m.called_numbers.length : 0),
            lastCalledNumber: m.last_called_number,
            date: formattedDate,
            timestamp: m.ended_at,
          };
        });
      }
    } catch (e) {
      console.warn("Error querying match history from Supabase:", e.message);
    }
  }

  // Local fallback
  return getLocalMatches(userId);
}

export async function getUserStats(userId) {
  const localStats = getLocalStats(userId);

  if (isSupabaseConfigured && userId && !userId.startsWith("guest_") && !userId.startsWith("user_")) {
    try {
      const { data, error } = await supabase
        .from("online_matches")
        .select("result, player1_id, player2_id")
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`);

      if (!error && data) {
        let onlineWins = 0;
        let onlineLosses = 0;
        let onlineDraws = 0;

        data.forEach((m) => {
          const isP1 = m.player1_id === userId;
          if (m.result === "draw") onlineDraws++;
          else if ((m.result === "player1" && isP1) || (m.result === "player2" && !isP1)) onlineWins++;
          else onlineLosses++;
        });

        const onlineGames = data.length;
        const totalGames = localStats.gamesPlayed > onlineGames ? localStats.gamesPlayed : onlineGames;
        const totalWins = localStats.wins > onlineWins ? localStats.wins : onlineWins;
        const totalLosses = localStats.losses > onlineLosses ? localStats.losses : onlineLosses;
        const totalDraws = localStats.draws > onlineDraws ? localStats.draws : onlineDraws;

        const winRate = onlineGames > 0 ? ((onlineWins / onlineGames) * 100).toFixed(1) : "0.0";

        return {
          gamesPlayed: totalGames,
          wins: totalWins,
          losses: totalLosses,
          draws: totalDraws,
          onlineGames,
          onlineWins,
          onlineLosses,
          onlineDraws,
          winRate: `${winRate}%`,
        };
      }
    } catch {}
  }

  const onlineGames = localStats.onlineGames || 0;
  const onlineWins = localStats.onlineWins || 0;
  const winRate = onlineGames > 0 ? ((onlineWins / onlineGames) * 100).toFixed(1) : "0.0";

  return {
    gamesPlayed: localStats.gamesPlayed || 0,
    wins: localStats.wins || 0,
    losses: localStats.losses || 0,
    draws: localStats.draws || 0,
    onlineGames: localStats.onlineGames || 0,
    onlineWins: localStats.onlineWins || 0,
    onlineLosses: localStats.onlineLosses || 0,
    onlineDraws: localStats.onlineDraws || 0,
    winRate: `${winRate}%`,
  };
}
