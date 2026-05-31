#!/usr/bin/env python3
"""
Sends a scripted sequence of chat messages to irc_server.py.

Usage:
    python irc_sender.py

Make sure irc_server.py is running first.
Edit MESSAGES below to change what gets sent.
Each entry is (username, message, delay_seconds_after).
"""

import socket
import time
import sys

ADMIN_HOST = "127.0.0.1"
ADMIN_PORT = 7001

PLAY = [
    ("alice",   "!chess play",          0.1),
    ("bob",     "!chess play",          0.1),
    ("charlie", "!chess play",          0.1),
    ("1",   "!chess play",          0.1),
    ("2",   "!chess play",          0.1),
    ("3",   "!chess play",          0.1),
    ("4",   "!chess play",          0.1),
    ("5",   "!chess play",          0.1),
    ("6",   "!chess play",          0.1),
    ("7",   "!chess play",          0.1),
    ("8",   "!chess play",          0.1),
    ("9",   "!chess play",          0.1),
    ("10",   "!chess play",          0.1),
    ("11",   "!chess play",          0.1),
    ("12",   "!chess play",          0.1),
    ("13",   "!chess play",          0.1),
    ("14",   "!chess play",          0.1),
    ("15",   "!chess play",          0.1),
    ("16",   "!chess play",          0.1),
    ("17",   "!chess play",          0.1),
    ("18",   "!chess play",          0.1),
    ("19",   "!chess play",          0.1),
    ("20",   "!chess play",          0.1),
    ("21",   "!chess play",          0.1),
    ("22",   "!chess play",          0.1),
    ("23",   "!chess play",          0.1),
    ("24",   "!chess play",          0.1),
    ("25",   "!chess play",          0.1),
    ("26",   "!chess play",          0.1),
    ("27",   "!chess play",          0.1),
    ("28",   "!chess play",          0.1),
    ("29",   "!chess play",          0.1),
    ("30",   "!chess play",          0.1),
    ("31",   "!chess play",          0.1),
]

DE = [
    ("1",   "ich sage einen deutschen satz",          0.1),
    ("2",   "ich sage einen deutschen satz",          0.1),
    ("3",   "ich sage einen deutschen satz",          0.1),
    ("4",   "ich sage einen deutschen satz",          0.1),
    ("5",   "ich sage einen deutschen satz",          0.1),
    ("6",   "ich sage einen deutschen satz",          0.1),
    ("7",   "ich sage einen deutschen satz",          0.1),
    ("8",   "ich sage einen deutschen satz",          0.1),
    ("9",   "ich sage einen deutschen satz",          0.1),
    ("10",   "ich sage einen deutschen satz",          0.1),
    ("11",   "ich sage einen deutschen satz",          0.1),
    ("12",   "ich sage einen deutschen satz",          0.1),
    ("13",   "ich sage einen deutschen satz",          0.1),
    ("14",   "ich sage einen deutschen satz",          0.1),
    ("15",   "ich sage einen deutschen satz",          0.1),
    ("16",   "ich sage einen deutschen satz",          0.1),
    ("17",   "ich sage einen deutschen satz",          0.1),
    ("18",   "ich sage einen deutschen satz",          0.1),
    ("19",   "ich sage einen deutschen satz",          0.1),
    ("20",   "ich sage einen deutschen satz",          0.1),
    ("21",   "ich sage einen deutschen satz",          0.1),
    ("22",   "ich sage einen deutschen satz",          0.1),
    ("23",   "ich sage einen deutschen satz",          0.1),
    ("24",   "ich sage einen deutschen satz",          0.1),
    ("25",   "ich sage einen deutschen satz",          0.1),
    ("26",   "ich sage einen deutschen satz",          0.1),
    ("27",   "ich sage einen deutschen satz",          0.1),
    ("28",   "ich sage einen deutschen satz",          0.1),
    ("29",   "ich sage einen deutschen satz",          0.1),
    ("30",   "ich sage einen deutschen satz",          0.1),
    ("31",   "ich sage einen deutschen satz",          0.1),
]

EN = [
    ("1",   "english stuff yep cock",          0.1),
    ("2",   "english stuff yep cock",          0.1),
    ("3",   "english stuff yep cock",          0.1),
    ("4",   "english stuff yep cock",          0.1),
    ("5",   "english sentance",          0.1),
    ("6",   "english sentance",          0.1),
    ("7",   "english sentance",          0.1),
    ("8",   "english sentance",          0.1),
    ("9",   "english sentance",          0.1),
    ("10",   "english sentance",          0.1),
    ("11",   "english sentance",          0.1),
    ("12",   "english sentance",          0.1),
    ("13",   "english sentance",          0.1),
    ("14",   "english sentance",          0.1),
    ("15",   "english sentance",          0.1),
    ("16",   "english sentance",          0.1),
    ("17",   "english sentance",          0.1),
    ("18",   "english sentance",          0.1),
    ("19",   "english sentance",          0.1),
    ("20",   "english sentance",          0.1),
    ("21",   "english sentance",          0.1),
    ("22",   "english sentance",          0.1),
    ("23",   "english sentance",          0.1),
    ("24",   "english sentance",          0.1),
    ("25",   "english sentance",          0.1),
    ("26",   "english sentance",          0.1),
    ("27",   "english sentance",          0.1),
    ("28",   "english sentance",          0.1),
    ("29",   "english sentance",          0.1),
    ("30",   "english sentance",          0.1),
    ("31",   "english sentance",          0.1),
]
MESSAGES = PLAY if len(sys.argv) < 2 else EN
# ──────────────────────────────────────────────────────────────

def main():
    print(f"[sender] Connecting to {ADMIN_HOST}:{ADMIN_PORT}...")
    with socket.create_connection((ADMIN_HOST, ADMIN_PORT)) as sock:
        print(f"[sender] Connected. Sending {len(MESSAGES)} messages.\n")
        for username, message, delay in MESSAGES:
            line = f"{username}: {message}\n"
            sock.sendall(line.encode())
            print(f"  -> [{username}] {message}")
            time.sleep(delay)
    print("\n[sender] Done.")

if __name__ == "__main__":
    main()
