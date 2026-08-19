import { supabase, isSupabaseConfigured } from "./supabase";

const LOCAL_STORAGE_USER_KEY = "bingo_current_user";
const LOCAL_STORAGE_ACCOUNTS_REGISTRY = "bingo_registered_accounts";
const LOCAL_STORAGE_GUEST_ID_KEY = "bingo_guest_id";
const LOCAL_STORAGE_GUEST_NAME_KEY = "bingo_guest_name";

/**
 * Format auth errors into clean, user-friendly messages without exposing raw database details.
 */
export function formatAuthError(error) {
  if (!error) return "An unexpected error occurred.";
  const msg = error.message || String(error);
  if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials") || msg.includes("Invalid email or password")) {
    return "INVALID EMAIL OR PASSWORD";
  }
  if (msg.includes("User already registered") || msg.includes("already exists") || msg.includes("already registered")) {
    return "AN ACCOUNT WITH THIS EMAIL ALREADY EXISTS. PLEASE SIGN IN.";
  }
  if (msg.includes("Username already taken")) {
    return "USERNAME ALREADY TAKEN. PLEASE CHOOSE ANOTHER.";
  }
  if (msg.includes("Password should be at least")) {
    return "PASSWORD MUST BE AT LEAST 6 CHARACTERS.";
  }
  if (msg.includes("valid email") || msg.includes("invalid email")) {
    return "PLEASE ENTER A VALID EMAIL ADDRESS.";
  }
  if (msg.includes("Account not found") || msg.includes("ACCOUNT NOT FOUND")) {
    return "ACCOUNT NOT FOUND. PLEASE CHECK YOUR EMAIL OR SIGN UP.";
  }
  if (msg.includes("rate limit") || msg.includes("over_email_send_rate_limit")) {
    return "TOO MANY ATTEMPTS. PLEASE WAIT A MOMENT AND TRY AGAIN.";
  }
  return msg.toUpperCase();
}

/**
 * Local offline accounts registry helper (used when Supabase is not connected)
 */
function getLocalAccountsRegistry() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_ACCOUNTS_REGISTRY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalAccount(email, accountData) {
  try {
    const accounts = getLocalAccountsRegistry();
    accounts[email.toLowerCase()] = accountData;
    localStorage.setItem(LOCAL_STORAGE_ACCOUNTS_REGISTRY, JSON.stringify(accounts));
  } catch {}
}

export async function signUp({ email, password, username }) {
  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured) {
    // 1. Check if username is already taken in profiles table
    try {
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", cleanUsername)
        .maybeSingle();

      if (existingUser) {
        throw new Error("Username already taken. Please choose another.");
      }
    } catch (err) {
      if (err.message.includes("Username already taken")) throw err;
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
      // 3. Ensure profile exists in profiles table
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

  // Local/Offline Mode: check if account or username exists in registry
  const registry = getLocalAccountsRegistry();
  if (registry[cleanEmail]) {
    throw new Error("An account with this email already exists. Please Sign In.");
  }
  const isUsernameTaken = Object.values(registry).some(
    (acc) => acc.username.toLowerCase() === cleanUsername.toLowerCase()
  );
  if (isUsernameTaken) {
    throw new Error("Username already taken. Please choose another.");
  }

  const localId = "user_" + Math.random().toString(36).substring(2, 11);
  const profile = {
    id: localId,
    email: cleanEmail,
    username: cleanUsername,
    displayName: cleanUsername,
    isGuest: false,
    createdAt: new Date().toISOString(),
  };

  // Permanently save account in registry so signing in later restores this exact account
  saveLocalAccount(cleanEmail, profile);
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

      let username =
        profileData?.username ||
        data.user.user_metadata?.username ||
        cleanEmail.split("@")[0];

      // Safe recovery: If profile row is missing, restore it without overwriting
      if (!profileData) {
        try {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            username,
            display_name: username,
            online_status: "online",
            last_seen: new Date().toISOString(),
          });
        } catch {}
      } else {
        try {
          await supabase
            .from("profiles")
            .update({
              online_status: "online",
              last_seen: new Date().toISOString(),
            })
            .eq("id", data.user.id);
        } catch {}
      }

      const profile = {
        id: data.user.id,
        email: data.user.email,
        username,
        displayName: profileData?.display_name || username,
        isGuest: false,
        createdAt: profileData?.created_at || data.user.created_at || new Date().toISOString(),
      };

      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
      return profile;
    }
  }

  // Local/Offline Mode: retrieve the permanent account from registry
  const registry = getLocalAccountsRegistry();
  const existingAccount = registry[cleanEmail];

  if (!existingAccount) {
    throw new Error("ACCOUNT NOT FOUND. PLEASE CHECK YOUR EMAIL OR SIGN UP.");
  }

  const profile = {
    ...existingAccount,
    isGuest: false,
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

/**
 * SIGN OUT: Ends current session ONLY.
 * NEVER deletes the user account, profile, friends, history, or statistics.
 */
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

  // Clear current active session token from local storage
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
