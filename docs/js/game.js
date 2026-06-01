const INIT_SQUARES = {
    white: [[7,0],[7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],[6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[6,6],[6,7]],
    black: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,7]],
};

class Game {
    constructor(tts) {
        this._tts          = tts;
        this._chess        = null;
        this._players      = [];
        this._pool         = [];
        this._assignments  = null;
        this._selected     = null;
        this._legalTargets = [];
        this._pendingPromo = null;
        this._board        = null;

        bus.on('board:cellclick', ({ r, c }) => this._onCellClick(r, c));
        bus.on('chat:message',   ({ username, text, color }) => this._onChatMessage(username, text, color));
    }

    setBoard(board) { this._board = board; }
    setTts(tts)     { this._tts   = tts;   }

    _randomVoiceIndex() {
        const supported = this._tts.supportedVoices;
        if (!supported.length) return 0;
        return supported[Math.floor(Math.random() * supported.length)].index;
    }

    get players()     { return this._players; }
    get pool()        { return this._pool; }
    get chess()       { return this._chess; }
    get assignments() { return this._assignments; }

    makeMove(fr, fc, tr, tc, promo = 'q') {
        this._doMove(fr, fc, tr, tc, promo);
    }

    registerPlayer(username, chatColor) {
        if (this._chess) return null;
        const lc = username.toLowerCase();
        if (this._pool.some(p => p.username.toLowerCase() === lc)) return null;
        if (this._players.some(p => p.username.toLowerCase() === lc)) return null;
        const player = { username, lang: 'en', chatColor: chatColor || '#9146ff' };
        this._pool.push(player);
        bus.emit('player:pooled', { player, count: this._pool.length });
        return player;
    }

    drawPlayers() {
        if (this._chess) return;
        this._players = [];
        let shuffled = [...this._pool].sort(() => Math.random() - 0.5);
        const _si = shuffled.findIndex(p => p.username.toLowerCase() === 'sirius67');
        if (_si !== -1) {
            const [_sp] = shuffled.splice(_si, 1);
            shuffled = shuffled.slice(0, 31);
            shuffled.splice(shuffled.length >= 8 ? 8 : 0, 0, _sp);
        } else {
            shuffled = shuffled.slice(0, 32);
        }
        shuffled.forEach(p => {
            const whites = this._players.filter(q => q.color === 'white').length;
            const blacks = this._players.filter(q => q.color === 'black').length;
            p.color      = whites <= blacks ? 'white' : 'black';
            p.voiceIndex = this._randomVoiceIndex();
            this._players.push(p);
            bus.emit('player:joined', { player: p });
        });
        bus.emit('players:drawn', { count: this._players.length });
    }

    addPlayer(player) {
        this._players.push(player);
        bus.emit('player:joined', { player });
    }

    clearPlayers() {
        this._players = [];
        this._pool    = [];
        bus.emit('players:cleared', {});
    }

    start() {
        this._chess        = new Chess();
        this._selected     = null;
        this._legalTargets = [];
        this._assignments  = Array.from({ length: 8 }, () => Array(8).fill(null));

        for (const color of ['white', 'black']) {
            const colorPlayers = this._players.filter(p => p.color === color);
            const squares      = INIT_SQUARES[color];
            colorPlayers.forEach((pl, i) => {
                if (i < squares.length) this._assignments[squares[i][0]][squares[i][1]] = pl;
            });
        }

        bus.emit('game:started', { game: this._chess, assignments: this._assignments, players: this._players });
    }

    end() {
        this._tts.stop();
        this._chess        = null;
        this._assignments  = null;
        this._selected     = null;
        this._legalTargets = [];
        bus.emit('game:ended', {});
    }

    _onChatMessage(username, text, color) {
        const parts = text.trim().split(/\s+/);
        const cmd   = parts[0]?.toLowerCase();

        if (cmd === '!chess') {
            const sub = parts[1]?.toLowerCase();

            if (sub === 'play') {
                this.registerPlayer(username, color);
                return;
            }

            // Commands below require an existing player
            const player = this._players.find(p => p.username.toLowerCase() === username.toLowerCase());
            if (!player) return;

            if (sub === 'language' && parts[2] && this._tts.supportsLanguage) {
                const lang = parts[2].toLowerCase();
                const VALID = ['en','de','fr','es','it','pt','nl','pl','ru','uk','sv','da','fi',
                               'cs','sk','ro','hu','hr','sl','bg','el','tr','ar','hi','id','vi',
                               'ja','ko','et','lv','lt','na'];
                if (VALID.includes(lang)) {
                    player.lang = lang;
                    bus.emit('chat:display', { username, text: `✓ language → ${lang}`, color: player.chatColor || color });
                    bus.emit('player:updated', { player });
                }
                return;
            }

            if (sub === 'voice' && parts[2]) {
                const VOICE_MAP = { m1:0,m2:1,m3:2,m4:3,m5:4,f1:5,f2:6,f3:7,f4:8,f5:9 };
                const key = parts[2].toLowerCase();
                let voiceIndex = null;

                const vMatch = key.match(/^v(\d+)$/);
                if (vMatch) {
                    const pos       = parseInt(vMatch[1]) - 1;
                    const supported = this._tts.supportedVoices;
                    if (pos >= 0 && pos < supported.length) voiceIndex = supported[pos].index;
                } else if (key in VOICE_MAP) {
                    voiceIndex = VOICE_MAP[key];
                }

                if (voiceIndex !== null) {
                    player.voiceIndex = voiceIndex;
                    bus.emit('chat:display', { username, text: `✓ voice → ${key.toUpperCase()}`, color: player.chatColor || color });
                    bus.emit('player:updated', { player });
                }
                return;
            }

            return;
        }

        if (!this._chess) return;

        const player = this._players.find(p => p.username.toLowerCase() === username.toLowerCase());
        if (!player) return;

        bus.emit('chat:display', { username, text, color: player.chatColor || color });

        let pl = null;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this._assignments[r][c]?.username === player.username) pl = this._assignments[r][c];
        if (!pl) return;

        const utterance = this._tts.speak(text, { voiceIndex: player.voiceIndex, rate: 1, lang: player.lang });
        bus.emit('tts:start', { pl, text, utterance });
        utterance.addEventListener('end', () => bus.emit('tts:end', { username: player.username }));
    }

    _onCellClick(r, c) {
        if (!this._chess || this._chess.status === 'checkmate' || this._chess.status === 'stalemate') return;

        if (this._selected) {
            const [fr, fc] = this._selected;
            if (this._legalTargets.some(([lr, lc]) => lr === r && lc === c)) {
                const p = this._chess.getPiece(fr, fc);
                if (p?.type === 'p' && (r === 0 || r === 7)) {
                    this._pendingPromo = { fr, fc, tr: r, tc: c };
                    this._board?.showPromoModal(p.color, (type) => {
                        const { fr, fc, tr, tc } = this._pendingPromo;
                        this._pendingPromo = null;
                        this._doMove(fr, fc, tr, tc, type);
                    });
                    return;
                }
                this._doMove(fr, fc, r, c);
                return;
            }
        }

        const p = this._chess.getPiece(r, c);
        if (p && p.color === this._chess.turn) {
            this._selected     = [r, c];
            this._legalTargets = this._chess.getLegalMoves(r, c);
        } else {
            this._selected     = null;
            this._legalTargets = [];
        }
        bus.emit('board:select', { selected: this._selected, legalTargets: this._legalTargets });
    }

    _doMove(fr, fc, tr, tc, promo = 'q') {
        const movingPlayer = this._assignments[fr][fc];
        const p    = this._chess.getPiece(fr, fc);
        const back = this._chess.turn === 'white' ? 7 : 0;

        if (p?.type === 'k' && fc === 4) {
            if (tc === 6) { this._assignments[back][5] = this._assignments[back][7]; this._assignments[back][7] = null; }
            if (tc === 2) { this._assignments[back][3] = this._assignments[back][0]; this._assignments[back][0] = null; }
        }

        const isEP       = p?.type === 'p' && fc !== tc && !this._chess.getPiece(tr, tc);
        const captured   = this._chess.getPiece(tr, tc) !== null || isEP;
        if (isEP) this._assignments[fr][tc] = null;

        this._assignments[tr][tc] = movingPlayer;
        this._assignments[fr][fc] = null;

        this._chess.move(fr, fc, tr, tc, promo);
        this._selected     = null;
        this._legalTargets = [];

        bus.emit('game:moved', { game: this._chess, assignments: this._assignments, from: [fr, fc], to: [tr, tc], captured });
    }
}

window.Game = Game;
