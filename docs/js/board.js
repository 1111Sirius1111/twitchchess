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
                        piece.setPosition(r, c);
                        this._playerToPiece.set(pl, piece);
                    }
                }
            }

            // start idle wandering for all pieces, staggered
            this._playerToPiece.forEach(p => p.startIdle());
            this._render();
        });

        bus.on('game:moved', ({ game, assignments, to }) => {
            // destroy captured pieces
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

            // update every piece's board position
            for (let r = 0; r < 8; r++)
                for (let c = 0; c < 8; c++) {
                    const pl = assignments[r][c];
                    if (pl) this._playerToPiece.get(pl)?.setPosition(r, c);
                }

            // eye behaviour: check → look at king; otherwise → look at destination
            if (game.status === 'check' || game.status === 'checkmate') {
                const kingPos = this._findCheckKing();
                if (kingPos) {
                    this._playerToPiece.forEach((piece, pl) => {
                        if (pl?.color === game.turn) piece.lookAtSquare(kingPos[0], kingPos[1]);
                    });
                }
            } else {
                this._playerToPiece.forEach(piece => piece.lookAtSquare(tr, tc));
            }

            this._render();
        });

        bus.on('board:select', ({ selected, legalTargets }) => {
            this._selected     = selected;
            this._legalTargets = legalTargets;
            this._render();

            if (selected && this._assignments) {
                const selPl = this._assignments[selected[0]][selected[1]];
                this._playerToPiece.forEach((piece, pl) => {
                    if (pl === selPl) piece.lookForward();
                    else              piece.lookAtSquare(selected[0], selected[1]);
                });
            }
        });

        // other pieces watch the speaker
        bus.on('tts:start', ({ pl }) => {
            if (!this._assignments) return;
            let speakerPos = null;
            outer: for (let r = 0; r < 8; r++)
                for (let c = 0; c < 8; c++)
                    if (this._assignments[r][c] === pl) { speakerPos = [r, c]; break outer; }
            if (!speakerPos) return;
            this._playerToPiece.forEach((piece, p) => {
                if (p !== pl) piece.lookAtSquare(speakerPos[0], speakerPos[1]);
            });
        });

        bus.on('game:ended', () => {
            this._playerToPiece.forEach(p => p.destroy());
            this._playerToPiece.clear();
            this._game        = null;
            this._assignments = null;
        });

        let _cursorR = -1, _cursorC = -1;

        boardEl.addEventListener('mousemove', (e) => {
            if (!this._playerToPiece.size) return;
            const rect  = boardEl.getBoundingClientRect();
            const cellW = rect.width  / 8;
            const cellH = rect.height / 8;
            const relX  = e.clientX - rect.left;
            const relY  = e.clientY - rect.top;
            const c     = Math.floor(relX / cellW);
            const r     = Math.floor(relY / cellH);
            if (r < 0 || r > 7 || c < 0 || c > 7) return;

            const squareChanged = (r !== _cursorR || c !== _cursorC);
            _cursorR = r; _cursorC = c;

            this._playerToPiece.forEach(piece => {
                if (piece.isOnSquare(r, c)) {
                    // pixel-level tracking within own cell — fires every mousemove
                    piece.lookAtPixel(relX, relY, cellW, cellH);
                } else if (squareChanged) {
                    // square-level tracking for all other pieces — fires only on square change
                    piece.lookAtSquare(r, c, 500);
                }
            });
        });

        boardEl.addEventListener('mouseleave', () => {
            _cursorR = -1; _cursorC = -1;
            this._playerToPiece.forEach(piece => piece.resetGaze());
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
        const inner     = document.createElement('div');
        inner.className = 'piece-inner';
        inner.appendChild(pieceImg(color, type));

        const coords = EYE_COORDS[type];
        if (coords) {
            for (const side of ['left', 'right']) {
                const eye     = document.createElement('div');
                eye.className = 'piece-eye';
                eye.style.left = coords[side].x + '%';
                eye.style.top  = coords[side].y + '%';
                const { svg } = buildEyeSvg();
                eye.appendChild(svg);
                inner.appendChild(eye);
            }
        }
        wrap.appendChild(inner);
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
