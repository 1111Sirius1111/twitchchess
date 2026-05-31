# Twitch Chess — Architecture

## Overview

The application is split into small, single-responsibility modules that communicate exclusively through a central **Event Bus**. No module holds a direct reference to another. This makes it easy to swap out chat sources (Twitch vs. simulated) without touching any other module.

## Entry Points

| File | Chat source |
|---|---|
| `main.html` | Twitch IRC (`chat-twitch.js`) |
| `main_simulated.html` | Simulated panel (`chat-sim.js`) |

Both files are nearly identical HTML shells. The only difference is which chat source script is loaded.

## Modules

### `event-bus.js`
Tiny pub/sub. The only module every other module depends on.
```
bus.on(event, fn)
bus.off(event, fn)
bus.emit(event, payload)
```

### `chess.js`
Pure chess game logic. No DOM, no events. Tracks board state, validates moves, detects check/checkmate/stalemate.

### `tts.js`
Wraps the Web Speech API.
```
tts.speak(text, { voiceIndex, rate, onEnd, onBoundary })
tts.stop()
tts.voices  → SpeechSynthesisVoice[]
```

### `board.js`
Renders the chess board and all visual effects (piece pulse, message bubbles, legal move indicators). Listens to the bus for state changes and publishes user interactions.

**Listens to:**
- `game:started` — initial render
- `game:moved` — re-render after a move
- `tts:start` — begin speaking animation (pulse, message bubble, pagination)
- `tts:end` — clear message bubble

**Publishes:**
- `board:cellclick` → `{ r, c }`

### `game.js`
The brain. Wires `chess.js` and `tts.js` together. Handles player registration, move validation, piece assignment, and TTS dispatch. No direct DOM access.

**Listens to:**
- `chat:message` — check for moves, trigger TTS
- `board:cellclick` — handle piece selection and move execution

**Publishes:**
- `player:joined` → `{ player }`
- `game:started` → `{ players, assignments }`
- `game:ended` → `{}`
- `game:moved` → `{ from, to, assignments }`
- `tts:start` → `{ username, text, utterance }`
- `tts:end` → `{ username }`

### `chat-log.js`
Renders the chat message log panel. Pure display, no logic.

**Listens to:**
- `chat:message` — append entry to log

### `chat-twitch.js`
Connects to Twitch IRC via WebSocket. Wraps `twitch_chat.js`. Renders the connect/disconnect controls.

**Publishes:**
- `chat:message` → `{ username, text, color }`

### `chat-sim.js`
Renders the simulated chat panel (player dropdown + text input). Keeps the dropdown in sync with the current game state so the selected player always reflects the correct piece.

**Listens to:**
- `game:started` — populate player dropdown
- `game:ended` — disable panel
- `game:moved` — update piece preview in dropdown

**Publishes:**
- `chat:message` → `{ username, text, color }`

## Event Reference

| Event | Published by | Payload |
|---|---|---|
| `chat:message` | `chat-twitch.js`, `chat-sim.js` | `{ username, text, color }` |
| `board:cellclick` | `board.js` | `{ r, c }` |
| `player:joined` | `game.js` | `{ player }` |
| `game:started` | `game.js` | `{ players, assignments }` |
| `game:ended` | `game.js` | `{}` |
| `game:moved` | `game.js` | `{ from, to, assignments }` |
| `chat:display` | `game.js` | `{ username, text, color }` — registered players only |
| `tts:start` | `game.js` | `{ username, text, utterance }` |
| `tts:end` | `game.js` | `{ username }` |

## Dependency Graph

```
main.html / main_simulated.html
│
├── event-bus.js          (no dependencies)
├── chess.js              (no dependencies)
├── tts.js                (no dependencies)
├── twitch_chat.js        (no dependencies)
│
├── board.js              (event-bus)
├── chat-log.js           (event-bus)
├── game.js               (event-bus, chess.js, tts.js)
│
├── chat-twitch.js        (event-bus, twitch_chat.js)
│    OR
└── chat-sim.js           (event-bus)
```

No module depends on another module at the same level — all communication goes through the event bus.
