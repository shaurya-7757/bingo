import { supabase, isSupabaseConfigured } from "./supabase";

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
  const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_FRIENDS_KEY) || "{}");
  data[userId] = friends;
  localStorage.setItem(LOCAL_STORAGE_FRIENDS_KEY, JSON.stringify(data));
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
  const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_REQUESTS_KEY) || "{}");
  data[userId] = requests;
  localStorage.setItem(LOCAL_STORAGE_REQUESTS_KEY, JSON.stringify(data));
}

export async function searchUsers(searchTerm, currentUserId) {
  const cleanTerm = searchTerm.trim();
  if (!cleanTerm) return [];

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, online_status")
      .ilike("username", `%${cleanTerm}%`)
      .neq("id", currentUserId)
      .limit(10);

    if (error) throw error;
    return data || [];
  }

  // Local demo users
  const demoUsers = [
    { id: "demo_user_1", username: "Rahul", display_name: "Rahul", online_status: "online" },
    { id: "demo_user_2", username: "Aman", display_name: "Aman", online_status: "in_game" },
    { id: "demo_user_3", username: "Priya", display_name: "Priya", online_status: "offline" },
    { id: "demo_user_4", username: "Vikram", display_name: "Vikram", online_status: "online" },
  ];

  return demoUsers.filter(
    (u) =>
      u.id !== currentUserId &&
      u.username.toLowerCase().includes(cleanTerm.toLowerCase())
  );
}

export async function sendFriendRequest(senderId, receiverId) {
  if (senderId === receiverId) {
    throw new Error("You cannot send a friend request to yourself.");
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

    if (existingReq) {
      if (existingReq.status === "pending") {
        throw new Error("REQUEST ALREADY SENT");
      }
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

  // Local storage
  const requests = getLocalRequests(receiverId);
  if (requests.some((r) => r.senderId === senderId && r.status === "pending")) {
    throw new Error("REQUEST ALREADY SENT");
  }
  requests.push({
    id: "req_" + Date.now(),
    senderId,
    receiverId,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveLocalRequests(receiverId, requests);
  return true;
}

export async function getFriendRequests(userId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, status, created_at, sender:profiles!friend_requests_sender_id_fkey(id, username, display_name)")
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((item) => ({
      id: item.id,
      senderId: item.sender?.id,
      username: item.sender?.username || "Unknown",
      displayName: item.sender?.display_name || item.sender?.username || "Unknown",
      createdAt: item.created_at,
    }));
  }

  const rawReqs = getLocalRequests(userId);
  return rawReqs.filter((r) => r.status === "pending").map((r) => ({
    id: r.id,
    senderId: r.senderId,
    username: "Player_" + r.senderId.substring(0, 5),
    displayName: "Player",
    createdAt: r.createdAt,
  }));
}

export async function respondToFriendRequest(requestId, accept, senderId, receiverId) {
  if (isSupabaseConfigured) {
    if (accept) {
      // 1. Mark request as accepted
      await supabase
        .from("friend_requests")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", requestId);

      // 2. Create bi-directional friendship
      await supabase.from("friends").upsert([
        { user_id: senderId, friend_id: receiverId },
        { user_id: receiverId, friend_id: senderId },
      ]);
    } else {
      // Mark as declined or delete
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

  if (accept) {
    const userFriends = getLocalFriends(receiverId);
    userFriends.push({
      id: senderId,
      username: "Player_" + senderId.substring(0, 5),
      online_status: "online",
    });
    saveLocalFriends(receiverId, userFriends);
  }
  return true;
}

export async function getFriends(userId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("friends")
      .select("friend:profiles!friends_friend_id_fkey(id, username, display_name, online_status, last_seen)")
      .eq("user_id", userId);

    if (error) throw error;
    return (data || []).map((item) => ({
      id: item.friend?.id,
      username: item.friend?.username || "Unknown",
      displayName: item.friend?.display_name || item.friend?.username || "Unknown",
      onlineStatus: item.friend?.online_status || "offline",
      lastSeen: item.friend?.last_seen,
    }));
  }

  // Local fallback friends list
  return getLocalFriends(userId);
}

export async function removeFriend(userId, friendId) {
  if (isSupabaseConfigured) {
    await supabase
      .from("friends")
      .delete()
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`);
    return true;
  }

  const friends = getLocalFriends(userId).filter((f) => f.id !== friendId);
  saveLocalFriends(userId, friends);
  return true;
}
