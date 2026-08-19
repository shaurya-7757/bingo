# 🎯 Real-Time Multiplayer Bingo

A full-stack React & Node.js Bingo game with three modes:
1. 🤖 **Play Against AI** (Easy, Medium, Hard)
2. 👥 **Two Player** (Local pass-and-play)
3. 🌐 **Online Mode** (Real-time WebSocket multiplayer with private cards)

---

## 🏗️ Architecture

* **Live Website**: [https://shaurya-7757.github.io/bingo/](https://shaurya-7757.github.io/bingo/)
* **Frontend**: React + Vite (Hosted on GitHub Pages & Netlify/Vercel)
* **Multiplayer Engine**:
  * 🌐 **Serverless WebRTC Cloud (Default)**: 100% Free, Zero configuration, instant P2P rooms with zero card details.
  * 🔌 **Optional WebSocket Server**: Node.js + `ws` (Deployable to Render/Railway for custom server hosting).

---

## ⚙️ Environment Variables

Vite embeds environment variables prefixed with `VITE_` into the static JavaScript bundle at **build time**.

| Environment | Variable | Value | Where to Configure |
| :--- | :--- | :--- | :--- |
| **Local Development** | `VITE_WS_URL` | `ws://localhost:8080` | `.env` or `.env.local` |
| **Production (Netlify)** | `VITE_WS_URL` | `wss://YOUR-BACKEND.onrender.com` | Netlify Dashboard ➔ Site configuration ➔ Environment variables |

---

## 🚀 Local Development Checklist

### 1. Start the WebSocket Backend
```bash
cd backend
npm install
npm start
```
*Console output:* `WebSocket server running on port 8080`

### 2. Start the Frontend Dev Server (in project root)
```bash
npm install
npm run dev
```
*Open:* `http://localhost:5173/`

---

## 🌐 Production Deployment Guide

### Step 1: Deploy Backend to Render (or Railway)
1. Go to [Render.com](https://render.com) and click **New Web Service**.
2. Connect your Git repository.
3. Configure the service:
   * **Root Directory**: `backend`
   * **Runtime**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start`
4. Deploy the service and copy your Render URL (e.g. `https://my-bingo-backend.onrender.com`).
5. Your WebSocket URL will be:
   ```
   wss://my-bingo-backend.onrender.com
   ```

---

### Step 2: Configure Netlify Environment Variable
1. Log in to your [Netlify Dashboard](https://app.netlify.com/).
2. Select your site: `kaleidoscopic-dieffenbachia-a1c45f`.
3. Navigate to **Site configuration** ➔ **Environment variables**.
4. Add a new variable:
   * **Key**: `VITE_WS_URL`
   * **Value**: `wss://my-bingo-backend.onrender.com` *(use `wss://`, not `https://`)*
5. **Trigger a New Deploy**:
   * Go to **Deploys** ➔ **Trigger deploy** ➔ **Deploy site**.
   * *Why this is required:* Vite statically bakes `import.meta.env.VITE_WS_URL` into JavaScript assets during `npm run build`. Changing the variable in Netlify takes effect only after a rebuild/redeploy.

---

## 🧪 Testing Multiplayer

1. **Browser 1 (Creator)**:
   * Navigate to the site ➔ Click **🌐 ONLINE MODE**.
   * Status will show `🟢 CONNECTED` and `Server: <your-websocket-url>`.
   * Click **➕ CREATE GAME** ➔ Copy the 6-character room code (e.g. `A7K4P2`).

2. **Browser 2 / Incognito (Joiner)**:
   * Open the site in another browser or Incognito window.
   * Click **🌐 ONLINE MODE** ➔ **🔑 JOIN GAME**.
   * Enter the room code and click **JOIN GAME**.

3. **Gameplay**:
   * Real-time synchronized turns.
   * Player 1 and Player 2 cards remain completely private until game over.
   * Server calculates 5-line Bingo wins and draws authoritatively.
