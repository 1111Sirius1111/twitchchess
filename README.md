# Twitch Chess

A browser chess game where each Twitch chat viewers controls one piece on the board. Up to 32 players join via `!chess play`, get randomly assigned to a piece, and their chat messages are read aloud by that piece using neural or browser TTS.

**Play:** https://1111sirius1111.github.io/twitchchess/

Inspired by: https://www.youtube.com/watch?v=x0clwyeECs8

## Game Modes

- **Twitch** — connect to a live Twitch channel, viewers join the pool with `!chess play`, host draws players and starts the game
- **1v1 Simulated** — same mechanics but with dummy players, useful for testing
- **vs Bot** — white team vs a random-move bot for black

## TTS Backends

| Backend | Languages | Size | Notes |
|---|---|---|---|
| Web Speech API | browser voices | 0 MB | built-in, no download |
| Kokoro-82M | English | ~86 MB (WASM) / ~326 MB (WebGPU) | neural, high quality |
| Supertonic-3 | 31 languages | ~400 MB | neural, multilingual, voice styles M1–M5 / F1–F5 |

Neural models download once and are cached in the browser.

## Local Development

```bash
# Serve the site locally (no-cache)
python python/serve.py
# → http://localhost:8000

# Optional: local IRC server to simulate Twitch chat
python python/irc_server.py
# → ws://localhost:7000  (select "Local IRC" in the UI)

# Optional: inject scripted test messages
python python/irc_sender.py
```

See `architecture.md` for a full module and event reference.
