# Twitch Chess — Architecture

## Overview

A browser-only chess game where Twitch chat viewers each control one piece. All modules communicate through a central **Event Bus** — no module holds a direct reference to another. This makes it easy to swap chat sources, TTS backends, and game modes independently.

The site is hosted as a static GitHub Pages site from `docs/`. A Python dev server (`python/serve.py`) serves it locally without caching. A local IRC server (`python/irc_server.py`) simulates Twitch chat for testing.

---

## Entry Points

| File | Mode | Chat source |
|---|---|---|
| `docs/index.html` | Menu | — |
| `docs/html/main_chess_twitch.html` | Twitch | `chat-twitch.js` → real Twitch IRC or local IRC |
| `docs/html/main_chess_one_vs_one.html` | 1v1 Simulated | `chat-sim.js` |
| `docs/html/main_chess_vs_bot.html` | vs Bot | `chat-sim.js` + `bot.js` |
| `docs/html/voice-test.html` | TTS Demo | standalone (no chess) |

### Game modes

- **Twitch**: viewers type `!chess play` into chat to join a pool. The host clicks "Draw Players" to randomly assign up to 32 players to pieces (16 white, 16 black), then the game is played via board clicks. Each player's chat messages are read aloud by the piece they control.
- **1v1 Simulated**: identical setup but fills players from a hardcoded dummy list. A chat simulator panel lets the host impersonate any player.
- **vs Bot**: white team is 16 simulated players; black is a random-move bot (`bot.js`) that plays automatically after each white move.

---

## Module Reference

### `event-bus.js`
Global pub/sub. The only dependency shared by every other module.
```
bus.on(event, fn)
bus.off(event, fn)
bus.emit(event, payload)
```

---

### `chess.js`
Pure chess logic. No DOM, no events. Tracks board state, validates moves, resolves castling, en passant, and promotion. Sets `status` to `'playing'`, `'check'`, `'checkmate'`, or `'stalemate'` after each move. Sets `winner` to `'white'` or `'black'` on checkmate.

```
new Chess()
chess.move(fr, fc, tr, tc, promo)   → bool
chess.getLegalMoves(r, c)           → [r, c][]
chess.getPiece(r, c)                → { type, color } | null
chess.getThreatenedSquares(color)   → [r, c][]
chess.turn, chess.status, chess.winner, chess.lastMove
```

---

### `game.js`
The brain. Owns player lists, piece-to-player assignments, move execution, and TTS dispatch. No direct DOM access.

**Player assignment:** `_assignments[r][c]` maps each square to its player. Updated on every move, including castling (rook column swap) and en passant (captured pawn square cleared).

**Chat commands handled:**
- `!chess play` — registers the sender into the player pool
- `!chess voice <id>` — changes voice (`v1`…`vN` for Web Speech/Kokoro, `m1`–`m5`/`f1`–`f5` for Supertonic)
- `!chess language <code>` — changes language (Supertonic only, 31 codes)

**Listens to:** `board:cellclick`, `chat:message`

**Publishes:** `player:pooled`, `player:joined`, `player:updated`, `players:cleared`, `players:drawn`, `game:started`, `game:ended`, `game:moved`, `chat:display`, `tts:start`, `tts:end`, `board:select`

---

### `board.js`
Renders the board grid and all visual effects: piece images, username labels, message bubbles, legal move dots, capture rings, check highlight, last-move highlight, and piece pulse animation during TTS. Emits clicks.

**Listens to:** `game:started`, `game:moved`, `board:select`, `tts:start`, `tts:end`

**Publishes:** `board:cellclick` → `{ r, c }`

---

### TTS backends

All backends implement the same interface so they can be swapped at runtime:

```
speak(text, { voiceIndex, rate, lang? }) → SpeechHandle | SpeechSynthesisUtterance
stop()
voices          → voice[]
supportedVoices → { voice, index }[]
preload(onProgress) → Promise   // neural backends
supportsLanguage    → bool
onready             → callback  // neural backends
```

| Module | Backend | Notes |
|---|---|---|
| `tts.js` | Web Speech API | Browser built-in, English + German voices |
| `tts-kokoro.js` | Kokoro-82M ONNX | English only. WASM (~86 MB q8) or WebGPU (~326 MB fp32). Inline worker uses kokoro-js from jsDelivr |
| `tts-supertonic.js` | Supertonic-3 ONNX | 31 languages, 10 voice styles (M1–M5, F1–F5). WASM or WebGPU, ~400 MB total. Loads from HuggingFace, cached in Cache API |
| `tts-base.js` | — | Shared `SpeechHandle` class used by Kokoro and Supertonic. Fires `boundary` and `end` events, schedules word-boundary timers |
| `supertonic-worker.js` | Web Worker | Runs Supertonic inference. Downloads 4 ONNX models (duration predictor, text encoder, vector estimator, vocoder) + config + unicode indexer. Warms up WebGPU shaders on first load |

---

### Chat sources

#### `twitch_chat.js`
Raw Twitch IRC WebSocket client. No bus, no DOM. Parses IRC tags (`display-name`, `color`), handles PING/PONG keepalive, fires events via its own `.on()` API.

```
new TwitchChat()
chat.connect(channel, wsUrl)
chat.disconnect()
chat.on('message' | 'connected' | 'disconnected' | 'error', fn)
```

Connects anonymously as a `justinfan` user (read-only, no auth needed).

#### `chat-twitch.js`
Wraps `TwitchChat`, mounts the connect/disconnect UI, and bridges events to the bus. Supports both real Twitch (`wss://irc-ws.chat.twitch.tv:443`) and the local Python IRC server (`ws://127.0.0.1:7000`).

**Publishes:** `chat:message`, `chat:status`

#### `chat-sim.js`
Simulated chat panel for testing. Player dropdown + text input lets the host send messages as any registered player. Keeps the dropdown in sync with the game state.

**Listens to:** `game:started`, `game:ended`, `game:moved`

**Publishes:** `chat:message`

#### `chat-log.js`
Read-only chat message log. Appends entries for `chat:display` events (registered players only — raw `chat:message` is not shown here).

**Listens to:** `chat:display`

---

### `bot.js`
Random-move AI for black. Listens to `game:moved` and `game:started`, waits 500–1300 ms, then picks a random legal move for black and calls `game.makeMove()`. Stops on checkmate or stalemate.

---

## Event Reference

| Event | Publisher | Payload |
|---|---|---|
| `chat:message` | `chat-twitch.js`, `chat-sim.js` | `{ username, text, color }` |
| `chat:display` | `game.js` | `{ username, text, color }` — registered players only |
| `chat:status` | `chat-twitch.js` | `{ state, channel }` |
| `board:cellclick` | `board.js` | `{ r, c }` |
| `board:select` | `game.js` | `{ selected, legalTargets }` |
| `player:pooled` | `game.js` | `{ player, count }` |
| `player:joined` | `game.js` | `{ player }` |
| `player:updated` | `game.js` | `{ player }` |
| `players:cleared` | `game.js` | `{}` |
| `players:drawn` | `game.js` | `{ count }` |
| `game:started` | `game.js` | `{ game, assignments, players }` |
| `game:ended` | `game.js` | `{}` |
| `game:moved` | `game.js` | `{ game, assignments, from, to, captured }` |
| `tts:start` | `game.js` | `{ pl, text, utterance }` |
| `tts:end` | `game.js` | `{ username }` |

---

## Dependency Graph

```
docs/index.html
│
├── main_chess_twitch.html
│   ├── event-bus.js
│   ├── tts.js / tts-kokoro.js / tts-supertonic.js  (one active at runtime)
│   │                └── tts-base.js (SpeechHandle)
│   │                └── supertonic-worker.js (Web Worker, module)
│   ├── twitch_chat.js       (no deps)
│   ├── chess.js             (no deps)
│   ├── board.js             (event-bus)
│   ├── game.js              (event-bus, chess.js, tts)
│   ├── chat-log.js          (event-bus)
│   └── chat-twitch.js       (event-bus, twitch_chat.js)
│
├── main_chess_one_vs_one.html
│   └── … same as above but chat-sim.js instead of chat-twitch.js
│
├── main_chess_vs_bot.html
│   └── … same as one_vs_one + bot.js
│
└── voice-test.html          (standalone TTS demo, no game modules)
```

No module at the same level depends on another — all cross-module communication goes through the event bus.

---

## Python Dev Tools

| File | Purpose |
|---|---|
| `python/serve.py` | HTTP server for `docs/`, port 8000, no-cache headers |
| `python/irc_server.py` | Local WebSocket IRC server (port 7000) + admin TCP port (7001). Accepts messages from stdin (`username: message`) or from `irc_sender.py` |
| `python/irc_sender.py` | Scripted message sender. Connects to admin port 7001 and replays a list of `(username, message, delay)` tuples |

Usage:
```bash
# Terminal 1 — start HTTP server
python python/serve.py

# Terminal 2 — start local IRC server (optional, for Twitch mode testing)
python python/irc_server.py

# Terminal 3 — inject scripted players (optional)
python python/irc_sender.py
```
