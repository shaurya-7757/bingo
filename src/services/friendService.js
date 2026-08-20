import { supabase, isSupabaseConfigured } from "./supabase";
import { getLocalStats } from "./historyService";

const LOCAL_STORAGE_FRIENDS_KEY = "bingo_local_friends";
const LOCAL_STORAGE_REQUESTS_KEY = "bingo_local_requests";

function getLocalFriends(userId) {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_FRIENDS_KEY) || "{}");
    return data[userId] || [];
  } catch {
    return [];
  }
}

function saveLocalFriends(userId, friends) {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_FRIENDS_KEY) || "{}");
    data[userId] = friends;
    localStorage.setItem(LOCAL_STORAGE_FRIENDS_KEY, JSON.stringify(data));
  } catch {}
}

function getLocalRequests(userId) {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_REQUESTS_KEY) || "{}");
    return data[userId] || [];
  } catch {
    return [];
  }
}

function saveLocalRequests(userId, requests) {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_REQUESTS_KEY) || "{}");
    data[userId] = requests;
    localStorage.setItem(LOCAL_STORAGE_REQUESTS_KEY, JSON.stringify(data));
  } catch {}
}

// Demo fallback users for local/offline testing
const DEMO_USERS = [
  {
    id: "demo_user_1",
    username: "Rahul",
    displayName: "Rahul",
    onlineStatus: "online",
    createdAt: "2026-08-01T10:00:00Z",
    stats: { gamesPlayed: 24, wins: 14, losses: 7, draws: 3, winRate: "58.3%" },
  },
  {
    id: "demo_user_2",
    username: "Aman",
    displayName: "Aman",
    onlineStatus: "offline",
    createdAt: "2026-08-05T12:00:00Z",
    stats: { gamesPlayed: 10, wins: 4, losses: 5, draws: 1, winRate: "40.0%" },
  },
  {
    id: "demo_user_3",
    username: "Priya",
    displayName: "Priya",
    onlineStatus: "in_game",
    createdAt: "2026-08-10T15:30:00Z",
    stats: { gamesPlayed: 18, wins: 11, losses: 5, draws: 2, winRate: "61.1%" },
  },
  {
    id: "demo_user_4",
    username: "Vikram",
    displayName: "Vikram",
    onlineStatus: "online",
    createdAt: "2026-08-12T09:15:00Z",
    stats: { gamesPlayed: 32, wins: 20, losses: 10, draws: 2, winRate: "62.5%" },
  },
];

/**
 * SEARCH USERS
 * Searches users by username with indexed ilike query and computes relationship status.
 */
export async function searchUsers(searchTerm, currentUserId) {
  const cleanTerm = searchTerm.trim();
  if (!cleanTerm) return [];

  if (isSupabaseConfigured) {
    // 1. Fetch public profile fields only
    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, online_status, created_at")
      .ilike("username", `%${cleanTerm}%`)
      .limit(15);

    if (error) throw error;

    if (!users || users.length === 0) return [];

    // 2. Fetch current user's friendships and requests to compute relationship states
    const [{ data: friends }, { data: sentReqs }, { data: recReqs }] = await Promise.all([
      supabase.from("friends").select("friend_id").eq("user_id", currentUserId),
      supabase.from("friend_requests").select("id, receiver_id, status").eq("sender_id", currentUserId).eq("status", "pending"),
      supabase.from("friend_requests").select("id, sender_id, status").eq("receiver_id", currentUserId).eq("status", "pending"),
    ]);

    const friendIds = new Set((friends || []).map((f) => f.friend_id));
    const sentReqMap = new Map((sentReqs || []).map((r) => [r.receiver_id, r.id]));
    const recReqMap = new Map((recReqs || []).map((r) => [r.sender_id, r.id]));

    return users.map((u) => {
      let relationship = "none";
      let requestId = null;

      if (u.id === currentUserId) {
        relationship = "self";
      } else if (friendIds.has(u.id)) {
        relationship = "friends";
      } else if (sentReqMap.has(u.id)) {
        relationship = "request_sent";
        requestId = sentReqMap.get(u.id);
      } else if (recReqMap.has(u.id)) {
        relationship = "request_received";
        requestId = recReqMap.get(u.id);
      }

      return {
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        onlineStatus: u.online_status || "offline",
        createdAt: u.created_at,
        relationship,
        requestId,
      };
    });
  }

  // Local / Demo mode search
  const localFriends = getLocalFriends(currentUserId);
  const friendIds = new Set(localFriends.map((f) => f.id));
  const localIncoming = getLocalRequests(currentUserId);
  const localIncomingMap = new Map(localIncoming.filter((r) => r.status === "pending").map((r) => [r.senderId, r.id]));
  const localSent = getLocalSentRequests(currentUserId);
  const localSentMap = new Map(localSent.filter((r) => r.status === "pending").map((r) => [r.receiverId, r.id]));

  return DEMO_USERS.filter((u) => u.username.toLowerCase().includes(cleanTerm.toLowerCase())).map((u) => {
    let relationship = "none";
    let requestId = null;

    if (u.id === currentUserId) {
      relationship = "self";
    } else if (friendIds.has(u.id)) {
      relationship = "friends";
    } else if (localSentMap.has(u.id)) {
      relationship = "request_sent";
      requestId = localSentMap.get(u.id);
    } else if (localIncomingMap.has(u.id)) {
      relationship = "request_received";
      requestId = localIncomingMap.get(u.id);
    }

    return {
      ...u,
      relationship,
      requestId,
    };
  });
}

/**
 * SEND FRIEND REQUEST
 */
export async function sendFriendRequest(senderId, receiverId) {
  if (senderId === receiverId) {
    throw new Error("CANNOT ADD YOURSELF");
  }

  if (isSupabaseConfigured) {
    // Check if already friends
    const { data: existingFriend } = await supabase
      .from("friends")
      .select("id")
      .eq("user_id", senderId)
      .eq("friend_id", receiverId)
      .maybeSingle();

    if (existingFriend) {
      throw new Error("ALREADY FRIENDS");
    }

    // Check if request already pending
    const { data: existingReq } = await supabase
      .from("friend_requests")
      .select("id, status")
      .eq("sender_id", senderId)
      .eq("receiver_id", receiverId)
      .maybeSingle();

    if (existingReq && existingReq.status === "pending") {
      throw new Error("REQUEST ALREADY SENT");
    }

    const { data, error } = await supabase.from("friend_requests").upsert({
      sender_id: senderId,
      receiver_id: receiverId,
      status: "pending",
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
    return data;
  }

  // Local storage fallback
  const incoming = getLocalRequests(receiverId);
  if (incoming.some((r) => r.senderId === senderId && r.status === "pending")) {
    throw new Error("REQUEST ALREADY SENT");
  }
  const reqId = "req_" + Date.now();
  incoming.push({
    id: reqId,
    senderId,
    receiverId,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveLocalRequests(receiverId, incoming);

  const sent = getLocalSentRequests(senderId);
  sent.push({
    id: reqId,
    senderId,
    receiverId,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveLocalSentRequests(senderId, sent);
  return true;
}

/**
 * GET INCOMING FRIEND REQUESTS
 */
export async function getFriendRequests(userId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, status, created_at, sender:profiles!friend_requests_sender_id_fkey(id, username, display_name, online_status)")
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((item) => ({
      id: item.id,
      senderId: item.sender?.id,
      username: item.sender?.username || "Unknown",
      displayName: item.sender?.display_name || item.sender?.username || "Unknown",
      onlineStatus: item.sender?.online_status || "offline",
      createdAt: item.created_at,
    }));
  }

  const rawReqs = getLocalRequests(userId);
  return rawReqs.filter((r) => r.status === "pending").map((r) => {
    const demo = DEMO_USERS.find((u) => u.id === r.senderId);
    return {
      id: r.id,
      senderId: r.senderId,
      username: demo?.username || "Player_" + r.senderId.substring(0, 5),
      displayName: demo?.displayName || "Player",
      onlineStatus: demo?.onlineStatus || "offline",
      createdAt: r.createdAt,
    };
  });
}

function getLocalSentRequests(userId) {
  try {
    const data = JSON.parse(localStorage.getItem("bingo_local_sent_requests") || "{}");
    return data[userId] || [];
  } catch {
    return [];
  }
}

function saveLocalSentRequests(userId, requests) {
  try {
    const data = JSON.parse(localStorage.getItem("bingo_local_sent_requests") || "{}");
    data[userId] = requests;
    localStorage.setItem("bingo_local_sent_requests", JSON.stringify(data));
  } catch {}
}

/**
 * GET SENT (OUTGOING) FRIEND REQUESTS
 */
export async function getSentFriendRequests(userId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, status, created_at, receiver:profiles!friend_requests_receiver_id_fkey(id, username, display_name, online_status)")
      .eq("sender_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((item) => ({
      id: item.id,
      receiverId: item.receiver?.id,
      username: item.receiver?.username || "Unknown",
      displayName: item.receiver?.display_name || item.receiver?.username || "Unknown",
      onlineStatus: item.receiver?.online_status || "offline",
      createdAt: item.created_at,
    }));
  }

  const rawSent = getLocalSentRequests(userId);
  return rawSent.filter((r) => r.status === "pending").map((r) => {
    const demo = DEMO_USERS.find((u) => u.id === r.receiverId);
    return {
      id: r.id,
      receiverId: r.receiverId,
      username: demo?.username || "Player_" + r.receiverId.substring(0, 5),
      displayName: demo?.displayName || "Player",
      onlineStatus: demo?.onlineStatus || "offline",
      createdAt: r.createdAt,
    };
  });
}

/**
 * CANCEL OUTGOING FRIEND REQUEST
 */
export async function cancelFriendRequest(requestId, senderId, receiverId) {
  if (isSupabaseConfigured) {
    const { error } = await supabase
      .from("friend_requests")
      .delete()
      .eq("id", requestId);
    if (error) throw error;
    return true;
  }

  // Local fallback
  const sent = getLocalSentRequests(senderId).filter((r) => r.id !== requestId);
  saveLocalSentRequests(senderId, sent);

  if (receiverId) {
    const incoming = getLocalRequests(receiverId).filter((r) => r.id !== requestId);
    saveLocalRequests(receiverId, incoming);
  }
  return true;
}

/**
 * RESPOND TO INCOMING FRIEND REQUEST (ACCEPT / DECLINE)
 */
export async function respondToFriendRequest(requestId, accept, senderId, receiverId) {
  if (isSupabaseConfigured) {
    if (accept) {
      // 1. Mark request as accepted
      await supabase
        .from("friend_requests")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", requestId);

      // 2. Create symmetric bi-directional friendship
      await supabase.from("friends").upsert([
        { user_id: senderId, friend_id: receiverId },
        { user_id: receiverId, friend_id: senderId },
      ]);
    } else {
      // Remove or mark declined
      await supabase
        .from("friend_requests")
        .delete()
        .eq("id", requestId);
    }
    return true;
  }

  // Local fallback
  const reqs = getLocalRequests(receiverId).filter((r) => r.id !== requestId);
  saveLocalRequests(receiverId, reqs);

  const sent = getLocalSentRequests(senderId).filter((r) => r.id !== requestId);
  saveLocalSentRequests(senderId, sent);

  if (accept) {
    const receiverFriends = getLocalFriends(receiverId);
    const demoSender = DEMO_USERS.find((u) => u.id === senderId);
    if (!receiverFriends.some((f) => f.id === senderId)) {
      receiverFriends.push({
        id: senderId,
        username: demoSender?.username || "Player_" + senderId.substring(0, 5),
        displayName: demoSender?.displayName || "Player",
        onlineStatus: demoSender?.onlineStatus || "online",
        createdAt: demoSender?.createdAt || new Date().toISOString(),
      });
      saveLocalFriends(receiverId, receiverFriends);
    }

    const senderFriends = getLocalFriends(senderId);
    if (!senderFriends.some((f) => f.id === receiverId)) {
      senderFriends.push({
        id: receiverId,
        username: "Player_" + receiverId.substring(0, 5),
        displayName: "Player",
        onlineStatus: "online",
        createdAt: new Date().toISOString(),
      });
      saveLocalFriends(senderId, senderFriends);
    }
  }
  return true;
}

/**
 * GET CONFIRMED FRIENDS WITH ONLINE STATISTICS
 */
export async function getFriends(userId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("friends")
      .select("friend:profiles!friends_friend_id_fkey(id, username, display_name, online_status, last_seen, created_at)")
      .eq("user_id", userId);

    if (error) throw error;
    if (!data || data.length === 0) return [];

    const friendProfiles = data.map((item) => ({
      id: item.friend?.id,
      username: item.friend?.username || "Unknown",
      displayName: item.friend?.display_name || item.friend?.username || "Unknown",
      onlineStatus: item.friend?.online_status || "offline",
      lastSeen: item.friend?.last_seen,
      createdAt: item.friend?.created_at,
    }));

    // Fetch stats for all friends in parallel
    const friendsWithStats = await Promise.all(
      friendProfiles.map(async (friend) => {
        try {
          const stats = await getPublicUserStats(friend.id);
          return { ...friend, stats };
        } catch {
          return {
            ...friend,
            stats: { gamesPlayed: 0, wins: 0, losses: 0, draws: 0, winRate: "0.0%" },
          };
        }
      })
    );

    return friendsWithStats;
  }

  // Local fallback
  const rawFriends = getLocalFriends(userId);
  if (rawFriends.length === 0) {
    // Default initial mock friend for immediate demonstration
    const defaultFriends = [DEMO_USERS[0], DEMO_USERS[1]];
    saveLocalFriends(userId, defaultFriends);
    return defaultFriends;
  }
  return rawFriends.map((f) => {
    const demo = DEMO_USERS.find((u) => u.id === f.id);
    return {
      ...f,
      stats: demo?.stats || { gamesPlayed: 6, wins: 3, losses: 2, draws: 1, winRate: "50.0%" },
    };
  });
}

/**
 * REMOVE FRIEND
 */
export async function removeFriend(userId, friendId) {
  if (isSupabaseConfigured) {
    await supabase
      .from("friends")
      .delete()
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);
    return true;
  }

  // Local fallback
  const userFriends = getLocalFriends(userId).filter((f) => f.id !== friendId);
  saveLocalFriends(userId, userFriends);

  const friendFriends = getLocalFriends(friendId).filter((f) => f.id !== userId);
  saveLocalFriends(friendId, friendFriends);
  return true;
}

/**
 * GET PUBLIC USER STATS (Safe aggregated data, zero private details)
 */
export async function getPublicUserStats(userId) {
  if (isSupabaseConfigured && userId && !userId.startsWith("guest_") && !userId.startsWith("user_") && !userId.startsWith("demo_")) {
    try {
      const { data, error } = await supabase
        .from("online_matches")
        .select("result, player1_id, player2_id")
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`);

      if (!error && data) {
        let wins = 0;
        let losses = 0;
        let draws = 0;

        data.forEach((m) => {
          const isP1 = m.player1_id === userId;
          if (m.result === "draw") draws++;
          else if ((m.result === "player1" && isP1) || (m.result === "player2" && !isP1)) wins++;
          else losses++;
        });

        const gamesPlayed = data.length;
        const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) + "%" : "0.0%";

        return {
          gamesPlayed,
          wins,
          losses,
          draws,
          winRate,
        };
      }
    } catch {}
  }

  const local = getLocalStats(userId);
  const gamesPlayed = local.onlineGames || 0;
  const wins = local.onlineWins || 0;
  const losses = local.onlineLosses || 0;
  const draws = local.onlineDraws || 0;
  const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) + "%" : "0.0%";
  return { gamesPlayed, wins, losses, draws, winRate };
}

/**
 * GET SAFE PUBLIC USER PROFILE
 * Returns ONLY public columns (username, display_name, online_status, created_at, stats).
 * Strictly hides email, auth tokens, passwords, and private settings.
 */
export async function getPublicUserProfile(targetUserId, currentUserId) {
  if (isSupabaseConfigured && targetUserId && !targetUserId.startsWith("demo_")) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, online_status, last_seen, created_at")
      .eq("id", targetUserId)
      .single();

    if (error) throw error;

    const stats = await getPublicUserStats(targetUserId);

    // Check relationship if currentUserId is provided
    let isFriend = false;
    if (currentUserId && currentUserId !== targetUserId) {
      const { data: friendRow } = await supabase
        .from("friends")
        .select("id")
        .eq("user_id", currentUserId)
        .eq("friend_id", targetUserId)
        .maybeSingle();
      isFriend = !!friendRow;
    }

    return {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name || profile.username,
      onlineStatus: profile.online_status || "offline",
      lastSeen: profile.last_seen,
      createdAt: profile.created_at,
      stats,
      isFriend,
    };
  }

  // Demo user fallback
  const demo = DEMO_USERS.find((u) => u.id === targetUserId) || {
    id: targetUserId,
    username: "Player_" + targetUserId.substring(0, 5),
    displayName: "Player",
    onlineStatus: "online",
    createdAt: "2026-08-01T10:00:00Z",
    stats: { gamesPlayed: 12, wins: 7, losses: 4, draws: 1, winRate: "58.3%" },
  };

  const localFriends = currentUserId ? getLocalFriends(currentUserId) : [];
  const isFriend = localFriends.some((f) => f.id === targetUserId);

  return {
    ...demo,
    isFriend,
  };
}
