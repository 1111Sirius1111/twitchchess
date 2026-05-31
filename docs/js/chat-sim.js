const DUMMY_NAMES = [
    'KingSlayer','QueenBee','RookMaster','BishopBob','KnightOwl','PawnStar',
    'CastleKing','GrandMaster','ChessWizard','BoardControl','OpeningBook','EndgameGod',
    'TacticsGuru','BlitzKing','ForkLord','PinMaster',
    'ShadowBlade','DarkKnight','VoidRook','NightQueen','ObsidianKing','CrimsonPawn',
    'IronFist','SteelGuard','PhantomLancer','RavenBishop','StormRider','BlackWarden',
    'OnyxSentinel','GrimVanguard','DuskForce','TwilightPawn',
];

const DUMMY_COLORS = [
    '#ff4500','#1e90ff','#00ff7f','#ff69b4','#ffd700','#9400d3',
    '#00ced1','#ff6347','#7fff00','#dc143c','#00bfff','#ff8c00',
    '#adff2f','#da70d6','#40e0d0','#f08080',
];

const PERSONALITY_LINES = {
    selected: [
        "Send me to battle!",
        "Ready for orders!",
        "Where shall I go?",
        "At your command!",
        "Finally, my turn!",
        "I await your move.",
        "Let's do this!",
        "Pick me wisely.",
        "I trust you.",
        "I'm ready!",
    ],
    moved: [
        "Moving out!",
        "On my way.",
        "As you wish.",
        "Consider it done.",
        "Advancing!",
        "Here I go.",
    ],
    captures: [
        "Gotcha!",
        "One down!",
        "For the team!",
        "Nothing personal.",
        "Better luck next time!",
        "Out of my way!",
        "Eliminated.",
        "You should have run.",
    ],
    givesCheck: [
        "Check!",
        "Feel my power!",
        "The king trembles!",
        "Nowhere to hide!",
        "You can't escape!",
        "Bow before me!",
        "How does that feel?",
    ],
    inDanger: [
        "I feel threatened...",
        "Is someone targeting me?",
        "I don't like how they're looking at me.",
        "This doesn't feel safe.",
        "Watch out, they're coming for me!",
        "Should I be worried?",
        "Someone cover me!",
        "I have a bad feeling about this.",
    ],
    inCheck: [
        "I am scared!",
        "Someone protect me!",
        "This is bad...",
        "Help! I need backup!",
        "Not good, not good!",
        "Get them away from me!",
        "I don't want to die!",
    ],
    promoted: [
        "I made it!",
        "Finally a promotion!",
        "From pawn to queen, baby!",
        "Dreams do come true.",
        "All that walking paid off!",
        "I have ascended!",
    ],
    checkmate: [
        "Victory is ours!",
        "That's checkmate!",
        "We win!",
        "They never stood a chance.",
        "Glory to the team!",
    ],
    gameStart: [
        "Let's show them what we've got!",
        "For glory!",
        "I'm ready to fight!",
        "Let the game begin!",
        "I was born for this.",
        "Don't mess this up.",
    ],
};

class ChatSim {
    constructor(tts) {
        this._tts         = tts;
        this._players     = [];
        this._chess       = null;
        this._assignments = null;
        this._simPanelEl  = null;

        bus.on('game:started', ({ game, players, assignments }) => {
            this._chess       = game;
            this._players     = players;
            this._assignments = assignments;
            if (this._simPanelEl) {
                this._simPanelEl.style.display = 'flex';
                this._populateDropdown();
            }
            const sample = [...players].sort(() => Math.random() - 0.5).slice(0, 2);
            sample.forEach((p, i) =>
                setTimeout(() => this._say(p.username, this._pick(PERSONALITY_LINES.gameStart)), i * 1200)
            );
        });

        bus.on('game:moved', ({ game, assignments, to, captured }) => {
            this._chess       = game;
            this._assignments = assignments;
            this._updateDetails();
            this._onMove(game, assignments, to, captured);
        });

        bus.on('board:select', ({ selected }) => {
            if (!selected || !this._assignments) return;
            const pl = this._assignments[selected[0]][selected[1]];
            if (pl) this._say(pl.username, this._pick(PERSONALITY_LINES.selected));
        });

        bus.on('game:ended', () => {
            this._chess       = null;
            this._assignments = null;
            if (this._simPanelEl) this._simPanelEl.style.display = 'none';
        });
    }

    // panelEl: game screen right panel area
    setTts(tts) { this._tts = tts; }

    mount(panelEl) {
        panelEl.innerHTML = `
            <h3>Simulate chat message</h3>
            <select id="sim-player"></select>
            <div id="sim-details"><div id="sim-details-text"></div></div>
            <div class="sim-send-row">
                <input id="sim-msg" type="text" placeholder="Message…">
                <button class="btn-orange" id="btn-sim-send">Send</button>
            </div>
        `;
        panelEl.id = 'sim-panel';
        panelEl.style.display = 'none';
        this._simPanelEl = panelEl;

        panelEl.querySelector('#btn-sim-send').addEventListener('click', () => this._send());
        panelEl.querySelector('#sim-msg').addEventListener('keydown', e => { if (e.key === 'Enter') this._send(); });
        panelEl.querySelector('#sim-player').addEventListener('change', () => this._updateDetails());
    }

    fillDummies(game) {
        game.clearPlayers();
        const names     = [...DUMMY_NAMES].sort(() => Math.random() - 0.5);
        const supported = this._tts.supportedVoices;
        for (let i = 0; i < 32; i++) {
            const voiceIndex = supported.length
                ? supported[Math.floor(Math.random() * supported.length)].index
                : 0;
            game.addPlayer({
                username:   names[i],
                color:      i < 16 ? 'white' : 'black',
                voiceIndex,
                chatColor:  DUMMY_COLORS[i % DUMMY_COLORS.length],
            });
        }
    }

    // Emit a personality line as a chat:message — flows through game.js (TTS + display)
    _say(username, line) {
        const player = this._players.find(p => p.username === username);
        if (!player || !line) return;
        const now = Date.now();
        if (player._pCooldown && now < player._pCooldown) return;
        player._pCooldown = now + 4000;
        bus.emit('chat:message', { username, text: line, color: player.chatColor });
    }

    _onMove(game, assignments, to, captured) {
        const movingPl = assignments[to[0]][to[1]];
        if (!movingPl) return;

        if (game.status === 'checkmate') {
            this._say(movingPl.username, this._pick(PERSONALITY_LINES.checkmate));
        } else if (game.status === 'check') {
            this._say(movingPl.username, this._pick(PERSONALITY_LINES.givesCheck));
            const kingPl = this._findKing(game.turn);
            if (kingPl) setTimeout(() => this._say(kingPl.username, this._pick(PERSONALITY_LINES.inCheck)), 800);
        } else if (captured) {
            this._say(movingPl.username, this._pick(PERSONALITY_LINES.captures));
        } else if (Math.random() < 0.25) {
            this._say(movingPl.username, this._pick(PERSONALITY_LINES.moved));
        }

        // Pawn promotion
        const board = game.getBoard();
        const piece = board[to[0]][to[1]];
        if (piece && piece.type !== 'p' && (to[0] === 0 || to[0] === 7))
            setTimeout(() => this._say(movingPl.username, this._pick(PERSONALITY_LINES.promoted)), 600);

        // Threatened pieces react
        if (game.status !== 'check' && game.status !== 'checkmate') {
            const threatened = this._findThreatenedPieces(game, assignments);
            if (threatened.length > 0) {
                const victim = threatened[Math.floor(Math.random() * threatened.length)];
                setTimeout(() => this._say(victim.username, this._pick(PERSONALITY_LINES.inDanger)), 500);
            }
        }
    }

    _findThreatenedPieces(game, assignments) {
        return game.getThreatenedSquares(game.turn)
            .map(([r, c]) => assignments[r][c])
            .filter(Boolean);
    }

    _findKing(color) {
        if (!this._chess || !this._assignments) return null;
        const board = this._chess.getBoard();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (board[r][c]?.type === 'k' && board[r][c]?.color === color)
                    return this._assignments[r][c];
        return null;
    }

    _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    _populateDropdown() {
        const sel = document.getElementById('sim-player');
        if (!sel) return;
        sel.innerHTML = '';
        this._players.forEach(p => {
            const opt = document.createElement('option');
            opt.value       = p.username;
            opt.textContent = `${p.username} (${p.color})`;
            opt.style.color = p.chatColor;
            sel.appendChild(opt);
        });
        this._updateDetails();
    }

    _updateDetails() {
        const username = document.getElementById('sim-player')?.value;
        const player   = this._players.find(p => p.username === username);
        const det      = document.getElementById('sim-details');
        if (!det) return;

        const oldImg = det.querySelector('img');
        if (oldImg) oldImg.remove();

        if (this._chess && this._assignments) {
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (this._assignments[r][c]?.username === username) {
                        const piece = this._chess.getPiece(r, c);
                        if (piece) det.prepend(pieceImg(piece.color, piece.type, 40));
                        break;
                    }
                }
            }
        }

        const txt = document.getElementById('sim-details-text');
        if (player && txt) {
            const vname = this._tts.voices[player.voiceIndex]?.name || `Voice #${player.voiceIndex}`;
            txt.innerHTML = '';
            const nameSpan = document.createElement('span');
            nameSpan.style.color = player.chatColor;
            nameSpan.style.fontWeight = 'bold';
            nameSpan.textContent = player.username;
            const voiceSpan = document.createElement('span');
            voiceSpan.className = 'det-voice';
            voiceSpan.textContent = vname;
            txt.appendChild(nameSpan);
            txt.appendChild(document.createElement('br'));
            txt.appendChild(voiceSpan);
        } else if (txt) {
            txt.textContent = '';
        }
    }

    _send() {
        const username = document.getElementById('sim-player')?.value;
        const msgEl    = document.getElementById('sim-msg');
        const text     = msgEl?.value.trim();
        if (!username || !text) return;
        const player = this._players.find(p => p.username === username);
        bus.emit('chat:message', { username, text, color: player?.chatColor || '#9146ff' });
        msgEl.value = '';
        msgEl.focus();
    }
}

function _escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.ChatSim    = ChatSim;
window.DUMMY_NAMES  = DUMMY_NAMES;
window.DUMMY_COLORS = DUMMY_COLORS;
