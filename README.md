# Real-Time Multiplayer Bingo

A full-stack Bingo gaming platform built with React, Vite, Node.js, and Supabase featuring Authentication, User Profiles, a Friend System, Real-Time Online Multiplayer, Online Match History, Statistics, and a complete Light/Dark Theme System.

Live Website: **[https://shaurya-7757.github.io/bingo/](https://shaurya-7757.github.io/bingo/)**

---

## Features

### 1. Authentication & Session Persistence
* **Sign Up**: Account registration with unique username, email, and password.
* **Sign In**: Secure authentication using Supabase Auth or persistent local registry.
* **Play as Guest**: 1-click temporary guest access (`GuestXXXX`) to jump straight into games without registration.
* **Forgot Password**: Password reset request capability.
* **Permanent Session**: Sessions and data are permanently retained across page refreshes, browser restarts, and device logins.
* **Safe Sign Out**: Ending a session leaves online rooms safely without deleting user accounts, friends, or statistics.

### 2. Light & Dark Theme System
* **Light Mode (Yellow + White)**: Crisp white surfaces, dark charcoal text, warm amber/yellow primary buttons and accents.
* **Dark Mode (Black + Red)**: Deep obsidian black surfaces, crisp white text, vibrant crimson red buttons and glowing accents.
* **Theme Switcher**: Instant `[ LIGHT ]` / `[ DARK ]` toggle bar.
* **Persistent Preference**: Theme choice persists across browser sessions.

### 3. User Profile & Live Statistics
* View username, email, account type (`REGISTERED MEMBER` or `GUEST ACCOUNT`), and joined date.
* **All-Time Stats**: Games Played, Wins, Losses, Draws.
* **Online Stats**: Online Games, Online Wins, Online Losses, Online Draws, and calculated **Win Rate %**.

### 4. Friend System & Real-Time Game Invites
* **My Friends**: Lists confirmed friends with live presence indicators (`ONLINE`, `IN GAME`, `OFFLINE`).
* **Invite to Game**: Click `INVITE TO GAME` next to any friend to create an online room and trigger an instant invitation popup on their screen with `[ ACCEPT ]` and `[ DECLINE ]`.
* **Friend Requests**: Dedicated tab for incoming friend requests with Accept and Decline actions.
* **Add Friend**: Case-insensitive user search with instant request delivery.

### 5. Online Match History
* Records every completed online match with date, opponent username, outcome (`WIN`, `LOSS`, `DRAW`), final line scores (`6 - 4`), total numbers called, and last called number.
* Interactive **Match Details Modal** for match review.

### 6. Game Modes
1. **Play Against AI**: 
   - **EASY**: Random moves with fast decisions (~700ms).
   - **MEDIUM**: Line completion detection, blocks player winning moves (~900ms).
   - **HARD**: Multi-factor heuristic evaluation prioritizing line generation and multi-line blocks (~1150ms).
   - Watchdog safety scheduler prevents freezes.
2. **Two Player (Local)**:
   - Pass-and-play on the same device.
3. **Online Mode (Real-Time Multiplayer)**:
   - 6-character room codes for easy sharing.
   - Authoritative synchronized called numbers history visible to both host and joiner.
   - Private opponent cards during play, revealed automatically on Game Over.
   - Server-side 5-line Bingo win detection and draw validation.

---

## Tech Stack & Architecture

* **Frontend**: React 18, Vite, Vanilla CSS design tokens.
* **Backend**: Node.js WebSocket server (`ws`), WebRTC Serverless fallback.
* **Database & Auth**: Supabase (PostgreSQL, Supabase Auth, Row Level Security).

---

## Database Schema & Migrations

The complete PostgreSQL migration script is located at [`supabase/schema.sql`](supabase/schema.sql):

* `public.profiles`: Stores User ID, unique username, display name, online status (`online`, `in_game`, `offline`), and timestamp.
* `public.friend_requests`: Handles pending, accepted, and declined friend requests.
* `public.friends`: Stores verified two-way friendships.
* `public.online_matches`: Stores completed multiplayer matches, line scores, and called numbers.
* **Row Level Security (RLS)**: Enforces access control on all tables.
* **Trigger**: `on_auth_user_created` automatically provisions a profile when a new user signs up in `auth.users`.

---

## Environment Variables

See [`.env.example`](.env.example):

```env
# Frontend (Vite)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key-here
VITE_WS_URL=

# Backend (Node.js WebSocket Server)
PORT=8080
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here
```

*(Note: The game features an automatic zero-break fallback, meaning guest play, local two-player, AI games, and multiplayer match history work out of the box even before Supabase keys are configured).*

---

## Local Development

### 1. Install Dependencies
```bash
npm install
cd backend && npm install && cd ..
```

### 2. Run WebSocket Server (Optional for custom server mode)
```bash
npm run server
```

### 3. Run Frontend
```bash
npm run dev
```

Open: `http://localhost:5173/`

### 4. Build for Production
```bash
npm run build
```

---

## License
MIT
