class Chess {
    constructor() { this.reset(); }

    reset() {
        this._board = this._initBoard();
        this.turn = 'white';
        this._castling = { white: { k: true, q: true }, black: { k: true, q: true } };
        this._ep = null;
        this.status = 'playing';
        this.winner = null;
        this.lastMove = null;
    }

    _initBoard() {
        const b = Array.from({length: 8}, () => Array(8).fill(null));
        const back = ['r','n','b','q','k','b','n','r'];
        for (let c = 0; c < 8; c++) {
            b[0][c] = {type: back[c], color: 'black'};
            b[1][c] = {type: 'p', color: 'black'};
            b[6][c] = {type: 'p', color: 'white'};
            b[7][c] = {type: back[c], color: 'white'};
        }
        return b;
    }

    getBoard() {
        return this._board.map(r => r.map(p => p ? {...p} : null));
    }

    getPiece(r, c) { return this._board[r]?.[c] ?? null; }

    _clone(board) { return board.map(r => r.map(p => p ? {...p} : null)); }

    _inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

    _pseudoMoves(r, c, board, ep) {
        const p = board[r][c];
        if (!p) return [];
        const {type, color} = p;
        const enemy = color === 'white' ? 'black' : 'white';
        const moves = [];
        const free = (nr, nc) => this._inBounds(nr, nc) && !board[nr][nc];
        const foe  = (nr, nc) => this._inBounds(nr, nc) && board[nr][nc]?.color === enemy;
        const open = (nr, nc) => this._inBounds(nr, nc) && board[nr][nc]?.color !== color;
        const push = (nr, nc) => moves.push([nr, nc]);

        if (type === 'p') {
            const d = color === 'white' ? -1 : 1;
            const start = color === 'white' ? 6 : 1;
            if (free(r+d, c)) {
                push(r+d, c);
                if (r === start && free(r+2*d, c)) push(r+2*d, c);
            }
            for (const dc of [-1, 1]) {
                if (foe(r+d, c+dc)) push(r+d, c+dc);
                if (ep && r+d === ep[0] && c+dc === ep[1]) push(r+d, c+dc);
            }
        } else if (type === 'n') {
            for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
                if (open(r+dr, c+dc)) push(r+dr, c+dc);
        } else if (type === 'k') {
            for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
                if (open(r+dr, c+dc)) push(r+dr, c+dc);
        } else {
            const dirs = {
                r: [[-1,0],[1,0],[0,-1],[0,1]],
                b: [[-1,-1],[-1,1],[1,-1],[1,1]],
            };
            dirs.q = [...dirs.r, ...dirs.b];
            for (const [dr,dc] of dirs[type]) {
                let nr = r+dr, nc = c+dc;
                while (this._inBounds(nr, nc)) {
                    if (board[nr][nc]) { if (foe(nr,nc)) push(nr,nc); break; }
                    push(nr, nc);
                    nr += dr; nc += dc;
                }
            }
        }
        return moves;
    }

    _kingPos(color, board) {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (board[r][c]?.type === 'k' && board[r][c]?.color === color)
                    return [r, c];
        return null;
    }

    _attacked(r, c, byColor, board) {
        for (let pr = 0; pr < 8; pr++)
            for (let pc = 0; pc < 8; pc++)
                if (board[pr][pc]?.color === byColor)
                    if (this._pseudoMoves(pr, pc, board, null).some(([mr,mc]) => mr===r && mc===c))
                        return true;
        return false;
    }

    _inCheck(color, board) {
        const k = this._kingPos(color, board);
        if (!k) return false;
        const opp = color === 'white' ? 'black' : 'white';
        return this._attacked(k[0], k[1], opp, board);
    }

    _applyMove(board, fr, fc, tr, tc, ep, promo='q') {
        const b = this._clone(board);
        const p = b[fr][fc];
        if (p.type === 'p' && ep && tr === ep[0] && tc === ep[1]) {
            b[fr][tc] = null;
        }
        b[tr][tc] = p;
        b[fr][fc] = null;
        if (p.type === 'p' && (tr === 0 || tr === 7)) {
            b[tr][tc] = {type: promo, color: p.color};
        }
        return b;
    }

    // Returns [r, c] of pieces belonging to `color` that are attacked by the opponent.
    // Excludes the king since check is already tracked via this.status.
    getThreatenedSquares(color) {
        const attacker = color === 'white' ? 'black' : 'white';
        const result   = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this._board[r][c]?.color === color &&
                    this._board[r][c]?.type  !== 'k' &&
                    this._attacked(r, c, attacker, this._board))
                    result.push([r, c]);
        return result;
    }

    getLegalMoves(r, c) {
        const p = this._board[r][c];
        if (!p || p.color !== this.turn) return [];
        const opp = this.turn === 'white' ? 'black' : 'white';

        const legal = this._pseudoMoves(r, c, this._board, this._ep)
            .filter(([tr,tc]) => !this._inCheck(this.turn,
                this._applyMove(this._board, r, c, tr, tc, this._ep)));

        if (p.type === 'k' && !this._inCheck(this.turn, this._board)) {
            const back = this.turn === 'white' ? 7 : 0;
            const cast = this._castling[this.turn];
            if (cast.k && !this._board[back][5] && !this._board[back][6] &&
                !this._attacked(back, 5, opp, this._board) &&
                !this._attacked(back, 6, opp, this._board))
                legal.push([back, 6]);
            if (cast.q && !this._board[back][3] && !this._board[back][2] && !this._board[back][1] &&
                !this._attacked(back, 3, opp, this._board) &&
                !this._attacked(back, 2, opp, this._board))
                legal.push([back, 2]);
        }

        return legal;
    }

    move(fr, fc, tr, tc, promo='q') {
        if (this.status === 'checkmate' || this.status === 'stalemate') return false;
        const legal = this.getLegalMoves(fr, fc);
        if (!legal.some(([r,c]) => r===tr && c===tc)) return false;

        const p = this._board[fr][fc];
        const mover = this.turn;
        const opp   = this.turn === 'white' ? 'black' : 'white';
        const back   = this.turn === 'white' ? 7 : 0;
        const oppBack = opp === 'white' ? 7 : 0;

        if (p.type === 'k' && fc === 4) {
            if (tc === 6) { this._board[back][5] = this._board[back][7]; this._board[back][7] = null; }
            if (tc === 2) { this._board[back][3] = this._board[back][0]; this._board[back][0] = null; }
            this._castling[this.turn] = {k: false, q: false};
        }
        if (p.type === 'r') {
            if (fr === back && fc === 7) this._castling[this.turn].k = false;
            if (fr === back && fc === 0) this._castling[this.turn].q = false;
        }
        if (tr === oppBack && tc === 7) this._castling[opp].k = false;
        if (tr === oppBack && tc === 0) this._castling[opp].q = false;

        const newEp = (p.type === 'p' && Math.abs(tr-fr) === 2) ? [(fr+tr)/2, fc] : null;
        this._board = this._applyMove(this._board, fr, fc, tr, tc, this._ep, promo);
        this._ep = newEp;
        this.lastMove = {fr, fc, tr, tc};
        this.turn = opp;

        const hasLegal = this._hasAnyLegal();
        if (!hasLegal) {
            if (this._inCheck(this.turn, this._board)) {
                this.status = 'checkmate';
                this.winner = mover;
            } else {
                this.status = 'stalemate';
            }
        } else {
            this.status = this._inCheck(this.turn, this._board) ? 'check' : 'playing';
        }

        return true;
    }

    _hasAnyLegal() {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this._board[r][c]?.color === this.turn && this.getLegalMoves(r, c).length > 0)
                    return true;
        return false;
    }
}

window.Chess = Chess;
