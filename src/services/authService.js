import { supabase, isSupabaseConfigured } from "./supabase";

const LOCAL_STORAGE_USER_KEY = "bingo_current_user";
const LOCAL_STORAGE_GUEST_ID_KEY = "bingo_guest_id";
const LOCAL_STORAGE_GUEST_NAME_KEY = "bingo_guest_name";

/**
 * Format auth errors into clean, user-friendly messages.
 */
export function formatAuthError(error) {
  if (!error) return "An unexpected error occurred.";
  const msg = error.message || String(error);
  if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
    return "Incorrect email or password. Please try again.";
  }
  if (msg.includes("User already registered") || msg.includes("already exists")) {
    return "An account with this email already exists. Please Sign In.";
  }
  if (msg.includes("Password should be at least")) {
    return "Password must be at least 6 characters.";
  }
  if (msg.includes("valid email") || msg.includes("invalid email")) {
    return "Please enter a valid email address.";
  }
  if (msg.includes("rate limit") || msg.includes("over_email_send_rate_limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return msg;
}

export async function signUp({ email, password, username }) {
  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured) {
    // 1. Check if username is already taken in profiles table
    try {
      const { data: existingUser, error: checkError } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", cleanUsername)
        .maybeSingle();

      if (existingUser) {
        throw new Error("Username already taken. Please choose another.");
      }
    } catch (err) {
      if (err.message.includes("Username already taken")) throw err;
      // If table check fails due to network, proceed with auth signup
    }

    // 2. Register user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          username: cleanUsername,
          display_name: cleanUsername,
        },
      },
    });

    if (error) throw error;

    if (data?.user) {
      // Ensure profile exists in profiles table
      try {
        await supabase.from("profiles").upsert({
          id: data.user.id,
          username: cleanUsername,
          display_name: cleanUsername,
          online_status: "online",
          last_seen: new Date().toISOString(),
        });
      } catch (upsertErr) {
        console.warn("Profile upsert note:", upsertErr.message);
      }

      const profile = {
        id: data.user.id,
        email: data.user.email,
        username: cleanUsername,
        displayName: cleanUsername,
        isGuest: false,
        createdAt: data.user.created_at || new Date().toISOString(),
      };
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
      return profile;
    }
  }

  // Local/Offline Fallback if Supabase is not configured
  const localId = "user_" + Math.random().toString(36).substring(2, 11);
  const profile = {
    id: localId,
    email: cleanEmail,
    username: cleanUsername,
    displayName: cleanUsername,
    isGuest: false,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
  return profile;
}

export async function signIn({ email, password }) {
  const cleanEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) throw error;

    if (data?.user) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();

      const username =
        profileData?.username ||
        data.user.user_metadata?.username ||
        cleanEmail.split("@")[0];

      const profile = {
        id: data.user.id,
        email: data.user.email,
        username,
        displayName: profileData?.display_name || username,
        isGuest: false,
        createdAt: profileData?.created_at || data.user.created_at || new Date().toISOString(),
      };

      try {
        await supabase
          .from("profiles")
          .update({
            online_status: "online",
            last_seen: new Date().toISOString(),
          })
          .eq("id", data.user.id);
      } catch {}

      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
      return profile;
    }
  }

  // Local/Offline fallback
  const localSaved = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
  if (localSaved) {
    try {
      const parsed = JSON.parse(localSaved);
      if (!parsed.isGuest && parsed.email === cleanEmail) return parsed;
    } catch {}
  }

  const localId = "user_" + Math.random().toString(36).substring(2, 11);
  const username = cleanEmail.split("@")[0] || "Player";
  const profile = {
    id: localId,
    email: cleanEmail,
    username,
    displayName: username,
    isGuest: false,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
  return profile;
}

export function createGuestUser() {
  let guestId = localStorage.getItem(LOCAL_STORAGE_GUEST_ID_KEY);
  let guestName = localStorage.getItem(LOCAL_STORAGE_GUEST_NAME_KEY);

  if (!guestId) {
    guestId = "guest_" + Math.random().toString(36).substring(2, 9);
    localStorage.setItem(LOCAL_STORAGE_GUEST_ID_KEY, guestId);
  }
  if (!guestName) {
    guestName = "Guest" + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem(LOCAL_STORAGE_GUEST_NAME_KEY, guestName);
  }

  const guestProfile = {
    id: guestId,
    email: "",
    username: guestName,
    displayName: guestName,
    isGuest: true,
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(guestProfile));
  return guestProfile;
}

export async function getCurrentUser() {
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) {
        const user = data.session.user;
        const { data: profileData } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        const username =
          profileData?.username ||
          user.user_metadata?.username ||
          user.email?.split("@")[0] ||
          "Player";

        const profile = {
          id: user.id,
          email: user.email,
          username,
          displayName: profileData?.display_name || username,
          isGuest: false,
          createdAt: profileData?.created_at || user.created_at || new Date().toISOString(),
        };
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
        return profile;
      }
    } catch (err) {
      console.warn("Supabase session retrieval warning:", err.message);
    }
  }

  const stored = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export function subscribeToAuthChanges(callback) {
  if (isSupabaseConfigured) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        const user = session.user;
        const { data: profileData } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        const username =
          profileData?.username ||
          user.user_metadata?.username ||
          user.email?.split("@")[0] ||
          "Player";

        const profile = {
          id: user.id,
          email: user.email,
          username,
          displayName: profileData?.display_name || username,
          isGuest: false,
          createdAt: profileData?.created_at || user.created_at || new Date().toISOString(),
        };
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
        callback(profile);
      } else if (event === "SIGNED_OUT") {
        localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
        callback(null);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }
  return () => {};
}

export async function signOut(currentUser) {
  if (isSupabaseConfigured && currentUser && !currentUser.isGuest) {
    try {
      await supabase
        .from("profiles")
        .update({
          online_status: "offline",
          last_seen: new Date().toISOString(),
        })
        .eq("id", currentUser.id);
    } catch {}
    try {
      await supabase.auth.signOut();
    } catch {}
  }

  localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
}

export async function resetPassword(email) {
  if (isSupabaseConfigured) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw error;
    return true;
  }
  return true;
}
