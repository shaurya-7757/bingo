-- ==============================================================================
-- BINGO MULTIPLAYER SUPABASE DATABASE SCHEMA
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. PROFILES TABLE
-- Stores public user information and real-time presence
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  online_status TEXT NOT NULL DEFAULT 'offline' CHECK (online_status IN ('online', 'in_game', 'offline')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast case-insensitive username searching
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles(LOWER(username));

-- 3. FRIEND REQUESTS TABLE
-- Tracks pending, accepted, and declined friend requests
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_request CHECK (sender_id <> receiver_id),
  CONSTRAINT uq_sender_receiver UNIQUE (sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON public.friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON public.friend_requests(sender_id, status);

-- 4. FRIENDS TABLE
-- Stores confirmed bi-directional friendships
CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_friend CHECK (user_id <> friend_id),
  CONSTRAINT uq_friendship UNIQUE (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON public.friends(friend_id);

-- 5. ONLINE MATCHES TABLE
-- Stores authoritative completed online match records
CREATE TABLE IF NOT EXISTS public.online_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  player1_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  player1_username TEXT NOT NULL,
  player2_username TEXT NOT NULL,
  winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  result TEXT NOT NULL CHECK (result IN ('player1', 'player2', 'draw')),
  player1_lines INT NOT NULL DEFAULT 0,
  player2_lines INT NOT NULL DEFAULT 0,
  called_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_called_number INT,
  total_called INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_player1 ON public.online_matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON public.online_matches(player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_ended_at ON public.online_matches(ended_at DESC);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_matches ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
-- Anyone authenticated can view profiles (to search users and view friends)
CREATE POLICY "Profiles are viewable by authenticated users" 
  ON public.profiles FOR SELECT 
  TO authenticated 
  USING (true);

-- Users can insert their own profile upon registration
CREATE POLICY "Users can create their own profile" 
  ON public.profiles FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id) 
  WITH CHECK (auth.uid() = id);

-- FRIEND REQUESTS POLICIES
-- Users can view requests they sent or received
CREATE POLICY "Users can view their friend requests" 
  ON public.friend_requests FOR SELECT 
  TO authenticated 
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Users can send friend requests
CREATE POLICY "Users can send friend requests" 
  ON public.friend_requests FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = sender_id AND sender_id <> receiver_id);

-- Users can update requests they received (accept/decline)
CREATE POLICY "Receivers can update friend requests" 
  ON public.friend_requests FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id);

-- Senders or receivers can delete requests
CREATE POLICY "Users can delete their friend requests" 
  ON public.friend_requests FOR DELETE 
  TO authenticated 
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- FRIENDS POLICIES
-- Users can view their own friends
CREATE POLICY "Users can view their friends" 
  ON public.friends FOR SELECT 
  TO authenticated 
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can create friendships (or via accept trigger)
CREATE POLICY "Users can add friends" 
  ON public.friends FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = user_id);

-- Users can remove friendships
CREATE POLICY "Users can delete their friendships" 
  ON public.friends FOR DELETE 
  TO authenticated 
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ONLINE MATCHES POLICIES
-- Users can view matches where they were a participant
CREATE POLICY "Users can view their own match history" 
  ON public.online_matches FOR SELECT 
  TO authenticated 
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Server / service-role can insert matches (and authenticated players can insert verified matches)
CREATE POLICY "Allow match insert by participants" 
  ON public.online_matches FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

-- ==============================================================================
-- AUTOMATIC TRIGGER: CREATE PROFILE ON AUTH SIGNUP
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  raw_username TEXT;
BEGIN
  raw_username := NEW.raw_user_meta_data->>'username';
  IF raw_username IS NULL OR raw_username = '' THEN
    raw_username := 'User_' || SUBSTRING(NEW.id::TEXT, 1, 8);
  END IF;

  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id, raw_username, raw_username)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==============================================================================
-- SECURE ACCOUNT DELETION FUNCTION
-- Authenticated users can permanently delete their own account and cascade data
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account() 
RETURNS void AS $$
DECLARE
  current_user_id UUID;
BEGIN
  -- Extract caller's authenticated user ID
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Anonymize user reference in shared online match history (preserves opponent's record)
  UPDATE public.online_matches
  SET player1_id = NULL
  WHERE player1_id = current_user_id;

  UPDATE public.online_matches
  SET player2_id = NULL
  WHERE player2_id = current_user_id;

  UPDATE public.online_matches
  SET winner_id = NULL
  WHERE winner_id = current_user_id;

  -- 2. Delete all friendships and friend requests
  DELETE FROM public.friends
  WHERE user_id = current_user_id OR friend_id = current_user_id;

  DELETE FROM public.friend_requests
  WHERE sender_id = current_user_id OR receiver_id = current_user_id;

  -- 3. Delete profile
  DELETE FROM public.profiles
  WHERE id = current_user_id;

  -- 4. Delete auth user record permanently
  DELETE FROM auth.users
  WHERE id = current_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- ==============================================================================
-- GAME INVITATIONS TABLE & POLICIES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.game_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '120 seconds'),
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter ON public.game_invitations(inviter_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_invited ON public.game_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_room ON public.game_invitations(room_id);

ALTER TABLE public.game_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invitations they sent or received"
  ON public.game_invitations FOR SELECT
  TO authenticated
  USING (auth.uid() = inviter_id OR auth.uid() = invited_user_id);

CREATE POLICY "Users can create game invitations"
  ON public.game_invitations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = inviter_id);

CREATE POLICY "Participants can update invitation status"
  ON public.game_invitations FOR UPDATE
  TO authenticated
  USING (auth.uid() = inviter_id OR auth.uid() = invited_user_id);


