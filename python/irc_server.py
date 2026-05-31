#!/usr/bin/env python3
"""
Local Twitch IRC WebSocket server for testing main.html without a real Twitch stream.

Setup:
    pip install websockets

Run:
    python irc_server.py

Then open main.html, select Local IRC, type any channel name and click Connect.

Send messages interactively by typing in this terminal:
    username: message text
    message text        (sends as 'testuser')
    quit / exit         shut down

Send messages from a script:
    python irc_sender.py
The sender connects to the admin port (ADMIN_PORT) and sends lines in the same format.
"""

import asyncio
import sys
import websockets

PORT       = 7000
ADMIN_PORT = 7001

_COLORS = ['#ff4500', '#1e90ff', '#00ff7f', '#ff69b4', '#ffd700',
           '#9400d3', '#00ced1', '#ff6347', '#7fff00', '#dc143c']
_user_colors: dict[str, str] = {}
_color_counter = 0

def color_for(username: str) -> str:
    global _color_counter
    if username not in _user_colors:
        _user_colors[username] = _COLORS[_color_counter % len(_COLORS)]
        _color_counter += 1
    return _user_colors[username]

def make_privmsg(channel: str, username: str, text: str) -> str:
    color = color_for(username)
    tags  = f"display-name={username};color={color};user-type="
    return f"@{tags} :{username}!{username}@{username}.tmi.twitch.tv PRIVMSG #{channel} :{text}\r\n"

# channel -> websocket
clients: dict[str, websockets.ServerConnection] = {}

async def broadcast(username: str, message: str):
    if not clients:
        print("[server] No IRC clients connected yet.")
        return
    for channel, ws in list(clients.items()):
        privmsg = make_privmsg(channel, username, message)
        print(f"  -> [{username} → #{channel}] {message}")
        try:
            await ws.send(privmsg)
        except Exception as exc:
            print(f"[!] Send failed: {exc}")

def parse_line(text: str) -> tuple[str, str]:
    if ":" in text:
        username, _, message = text.partition(":")
        return username.strip() or "testuser", message.strip()
    return "testuser", text.strip()

# ── WebSocket IRC handler ──────────────────────────────────────
async def handle_ws(ws):
    channel = None
    print(f"[+] Browser connected from {ws.remote_address}")
    try:
        async for raw in ws:
            for line in raw.strip().split("\r\n"):
                line = line.strip()
                if not line:
                    continue
                print(f"  <- {line}")

                if line.startswith("PING"):
                    await ws.send("PONG :tmi.twitch.tv\r\n")
                elif line.startswith("CAP REQ"):
                    await ws.send(":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n")
                elif line.startswith("JOIN"):
                    channel = line.split("#", 1)[1].strip()
                    clients[channel] = ws
                    await ws.send(
                        f":justinfan00000!justinfan00000@justinfan00000.tmi.twitch.tv JOIN #{channel}\r\n"
                    )
                    print(f"[+] Joined #{channel}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if channel and clients.get(channel) is ws:
            del clients[channel]
        print(f"[-] Browser disconnected")

# ── Admin TCP handler (for irc_sender.py) ─────────────────────
async def handle_admin(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    addr = writer.get_extra_info('peername')
    print(f"[admin] Sender connected from {addr}")
    try:
        async for line in reader:
            text = line.decode().strip()
            if text:
                username, message = parse_line(text)
                await broadcast(username, message)
    except asyncio.IncompleteReadError:
        pass
    finally:
        writer.close()
        print(f"[admin] Sender disconnected")

# ── Stdin handler (interactive) ────────────────────────────────
async def read_stdin():
    loop   = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)

    while True:
        raw = await reader.readline()
        if not raw:
            break
        text = raw.decode().strip()
        if not text:
            continue
        if text.lower() in ("quit", "exit"):
            print("[server] Shutting down.")
            sys.exit(0)
        username, message = parse_line(text)
        await broadcast(username, message)

async def main():
    print(f"[server] IRC WebSocket  → ws://0.0.0.0:{PORT}")
    print(f"[server] Admin TCP      → 127.0.0.1:{ADMIN_PORT}  (for irc_sender.py)")
    print()

    admin_server = await asyncio.start_server(handle_admin, "127.0.0.1", ADMIN_PORT)
    async with admin_server, websockets.serve(handle_ws, "0.0.0.0", PORT):
        await read_stdin()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[server] Stopped.")
