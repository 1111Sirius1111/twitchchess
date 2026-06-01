const FILES = 'abcdefgh';

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

class ChessBoard {
    constructor() {
        this._game          = null;
        this._assignments   = null;
        this._selected      = null;
        this._legalTargets  = [];
        this._boardEl       = null;
        this._statusEl      = null;
        this._promoModalEl  = null;
        this._playerToPiece = new Map();
    }

    mount(boardEl, statusEl, promoModalEl) {
        this._boardEl      = boardEl;
        this._statusEl     = statusEl;
        this._promoModalEl = promoModalEl;

        bus.on('game:started', ({ game, assignments }) => {
            this._playerToPiece.forEach(p => p.destroy());
            this._playerToPiece.clear();

            this._game         = game;
            this._assignments  = assignments;
            this._selected     = null;
            this._legalTargets = [];

            const bd = game.getBoard();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const bp = bd[r][c];
                    const pl = assignments[r][c];
                    if (bp && pl) {
                        const piece = new Piece(bp.color, bp.type);
                        piece.setPlayer(pl);
                        this._playerToPiece.set(pl, piece);
                    }
                }
            }
            this._render();
        });

        bus.on('game:moved', ({ game, assignments, to }) => {
            // destroy pieces whose players are no longer on the board (captures)
            const living = new Set();
            for (let r = 0; r < 8; r++)
                for (let c = 0; c < 8; c++)
                    if (assignments[r][c]) living.add(assignments[r][c]);

            for (const [pl, piece] of this._playerToPiece) {
                if (!living.has(pl)) {
                    piece.destroy();
                    this._playerToPiece.delete(pl);
                }
            }

            // sync type at destination in case of promotion
            const [tr, tc] = to;
            const destPl   = assignments[tr][tc];
            if (destPl) {
                const piece   = this._playerToPiece.get(destPl);
                const newType = game.getBoard()[tr][tc]?.type;
                if (piece && newType) piece.setType(newType);
            }

            this._game         = game;
            this._assignments  = assignments;
            this._selected     = null;
            this._legalTargets = [];
            this._render();
        });

        bus.on('board:select', ({ selected, legalTargets }) => {
            this._selected     = selected;
            this._legalTargets = legalTargets;
            this._render();
        });

        bus.on('game:ended', () => {
            this._playerToPiece.forEach(p => p.destroy());
            this._playerToPiece.clear();
            this._game        = null;
            this._assignments = null;
        });
    }

    showPromoModal(color, callback) {
        const modal   = this._promoModalEl;
        const choices = modal.querySelector('#promo-choices');
        choices.innerHTML = '';
        for (const type of ['q', 'r', 'b', 'n']) {
            const btn   = document.createElement('button');
            btn.appendChild(pieceImg(color, type, 56));
            btn.title   = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type];
            btn.onclick = () => { modal.classList.remove('show'); callback(type); };
            choices.appendChild(btn);
        }
        modal.classList.add('show');
    }

    _findCheckKing() {
        if (!this._game || (this._game.status !== 'check' && this._game.status !== 'checkmate')) return null;
        const bd = this._game.getBoard();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (bd[r][c]?.type === 'k' && bd[r][c]?.color === this._game.turn) return [r, c];
        return null;
    }

    _renderStateless(color, type) {
        const wrap     = document.createElement('div');
        wrap.className = 'piece-symbol';
        wrap.appendChild(pieceImg(color, type));

        const coords = EYE_COORDS[type];
        if (coords) {
            for (const side of ['left', 'right']) {
                const eye     = document.createElement('div');
                eye.className = 'piece-eye';
                eye.style.left = coords[side].x + '%';
                eye.style.top  = coords[side].y + '%';
                eye.innerHTML  = EYE_SVG;
                wrap.appendChild(eye);
            }
        }
        return wrap;
    }

    _render() {
        if (!this._game) return;
        const boardEl = this._boardEl;
        boardEl.innerHTML = '';
        const bd      = this._game.getBoard();
        const lm      = this._game.lastMove;
        const kingPos = this._findCheckKing();

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell     = document.createElement('div');
                cell.className = 'cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');

                const isSel   = this._selected && this._selected[0] === r && this._selected[1] === c;
                const isLegal = this._legalTargets.some(([lr, lc]) => lr === r && lc === c);
                const isLast  = lm && ((lm.fr === r && lm.fc === c) || (lm.tr === r && lm.tc === c));
                const isCheck = kingPos && kingPos[0] === r && kingPos[1] === c;

                if (isCheck)     cell.classList.add('check-king');
                else if (isSel)  cell.classList.add('selected');
                else if (isLast) cell.classList.add('last-move');

                const p = bd[r][c];
                if (p) {
                    const pl    = this._assignments[r][c];
                    const piece = pl ? this._playerToPiece.get(pl) : null;

                    if (pl) {
                        const name     = document.createElement('div');
                        name.className = 'piece-name';
                        name.textContent = pl.username;
                        cell.appendChild(name);
                    }

                    if (piece) {
                        cell.appendChild(piece.redraw());
                        if (piece.msgEl) cell.appendChild(piece.msgEl);
                    } else {
                        cell.appendChild(this._renderStateless(p.color, p.type));
                    }

                    if (isLegal) {
                        const ring     = document.createElement('div');
                        ring.className = 'capture-ring';
                        cell.appendChild(ring);
                    }
                } else if (isLegal) {
                    const dot     = document.createElement('div');
                    dot.className = 'move-dot';
                    cell.appendChild(dot);
                }

                if (c === 0) {
                    const rank     = document.createElement('span');
                    rank.className = 'coords rank';
                    rank.textContent = 8 - r;
                    cell.appendChild(rank);
                }
                if (r === 7) {
                    const file     = document.createElement('span');
                    file.className = 'coords file';
                    file.textContent = FILES[c];
                    cell.appendChild(file);
                }

                cell.addEventListener('click', () => bus.emit('board:cellclick', { r, c }));
                boardEl.appendChild(cell);
            }
        }

        if (this._statusEl) {
            const g = this._game;
            if (g.status === 'checkmate')      this._statusEl.textContent = `Checkmate — ${cap(g.winner)} wins!`;
            else if (g.status === 'stalemate') this._statusEl.textContent = 'Stalemate — draw!';
            else if (g.status === 'check')     this._statusEl.textContent = `${cap(g.turn)} to move — CHECK!`;
            else                               this._statusEl.textContent = `${cap(g.turn)} to move`;
        }
    }
}

window.ChessBoard = ChessBoard;
