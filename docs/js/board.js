const PIECE_IMGS = {
    white: {
        k: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
        q: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
        r: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
        b: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
        n: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
        p: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
    },
    black: {
        k: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
        q: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
        r: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
        b: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
        n: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
        p: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
    },
};

const FILES = 'abcdefgh';

function pieceImg(color, type, size = null) {
    const img = document.createElement('img');
    img.src = PIECE_IMGS[color][type];
    if (size !== null) img.style.width = img.style.height = size + 'px';
    img.draggable = false;
    return img;
}

function wordEmphasis(word) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return 1.11;
    if (clean === clean.toUpperCase() && clean.length > 1) return 1.5;
    if (/[!?]{2,}/.test(word)) return 1.33;
    if (clean.length >= 9) return 1.28;
    if (clean.length >= 6) return 1.22;
    if (clean.length <= 2) return 1.11;
    return 1.17;
}

// Returns pages: [{text, lastWordIdx}] where lastWordIdx is the index (into the
// words array) of the last word on this page. The boundary handler advances the
// page when that word index is reached. Uses word counting, not charIndex, so it
// works in Chrome where charIndex is unreliable.
function paginateForElement(text, el) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const maxW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

    const words = text.split(/\s+/);
    const pages = [];
    let pageWords = [];
    let pageStartIdx = 0;

    for (let i = 0; i < words.length; i++) {
        const candidate = pageWords.length ? pageWords.join(' ') + ' ' + words[i] : words[i];
        if (ctx.measureText(candidate).width > maxW && pageWords.length > 0) {
            pages.push({ text: pageWords.join(' '), lastWordIdx: pageStartIdx + pageWords.length - 1 });
            pageStartIdx = i;
            pageWords = [words[i]];
        } else {
            pageWords.push(words[i]);
        }
    }
    if (pageWords.length) pages.push({ text: pageWords.join(' '), lastWordIdx: Infinity });
    return pages.length ? pages : [{ text, lastWordIdx: Infinity }];
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

class ChessBoard {
    constructor() {
        this._game        = null;
        this._assignments = null;
        this._selected    = null;
        this._legalTargets = [];
        this._boardEl     = null;
        this._statusEl    = null;
        this._promoModalEl = null;
    }

    mount(boardEl, statusEl, promoModalEl) {
        this._boardEl      = boardEl;
        this._statusEl     = statusEl;
        this._promoModalEl = promoModalEl;

        bus.on('game:started', ({ game, assignments }) => {
            this._game        = game;
            this._assignments = assignments;
            this._selected    = null;
            this._legalTargets = [];
            this._render();
        });

        bus.on('game:moved', ({ game, assignments }) => {
            this._game        = game;
            this._assignments = assignments;
            this._selected    = null;
            this._legalTargets = [];
            this._render();
        });

        bus.on('board:select', ({ selected, legalTargets }) => {
            this._selected     = selected;
            this._legalTargets = legalTargets;
            this._render();
        });

        bus.on('game:ended', () => {
            this._game        = null;
            this._assignments = null;
        });

        bus.on('tts:start', ({ pl, text, utterance }) => {
            this._showSpeaking(pl, text, utterance);
        });
    }

    showPromoModal(color, callback) {
        const modal   = this._promoModalEl;
        const choices = modal.querySelector('#promo-choices');
        choices.innerHTML = '';
        for (const type of ['q', 'r', 'b', 'n']) {
            const btn = document.createElement('button');
            btn.appendChild(pieceImg(color, type, 56));
            btn.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type];
            btn.onclick = () => { modal.classList.remove('show'); callback(type); };
            choices.appendChild(btn);
        }
        modal.classList.add('show');
    }

    _findPlayerCell(pl) {
        if (!this._assignments) return null;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this._assignments[r][c] === pl) return [r, c];
        return null;
    }

    _findCheckKing() {
        if (!this._game || (this._game.status !== 'check' && this._game.status !== 'checkmate')) return null;
        const bd = this._game.getBoard();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (bd[r][c]?.type === 'k' && bd[r][c]?.color === this._game.turn) return [r, c];
        return null;
    }

    _showSpeaking(pl, text, utterance) {
        clearTimeout(pl.msgTimer);
        pl.lastMsg    = text;
        pl.displayMsg = text;
        pl.pageIndex  = 0;
        this._render();

        const pos   = this._findPlayerCell(pl);
        const msgEl = pos ? document.getElementById(`msg-${pos[0]}-${pos[1]}`) : null;
        pl.pages      = msgEl ? paginateForElement(text, msgEl) : [{ text, lastWordIdx: Infinity }];
        pl.displayMsg = pl.pages[0].text;
        if (msgEl) msgEl.textContent = pl.displayMsg;

        const words   = text.split(/\s+/);
        let   wordIdx = -1;

        utterance.addEventListener('boundary', (e) => {
            if (e.name !== 'word') return;
            wordIdx++;
            const pos2 = this._findPlayerCell(pl);
            if (!pos2) return;
            const [r, c] = pos2;

            const sym = document.getElementById(`sym-${r}-${c}`);
            if (sym) {
                sym.style.transform = `scale(${wordEmphasis(words[wordIdx] || '')})`;
                setTimeout(() => { sym.style.transform = ''; }, 180);
            }

            const pages   = pl.pages;
            const nextIdx = pl.pageIndex + 1;
            if (nextIdx < pages.length && wordIdx >= pages[pl.pageIndex].lastWordIdx) {
                pl.pageIndex  = nextIdx;
                pl.displayMsg = pages[nextIdx].text;
                const msgEl2  = document.getElementById(`msg-${r}-${c}`);
                if (msgEl2) msgEl2.textContent = pl.displayMsg;
            }
        });

        utterance.addEventListener('end', () => {
            pl.msgTimer = setTimeout(() => {
                if (pl.lastMsg === text) { pl.lastMsg = null; pl.displayMsg = null; this._render(); }
            }, 1000);
        });
    }

    _render() {
        if (!this._game) return;
        const boardEl  = this._boardEl;
        boardEl.innerHTML = '';
        const bd       = this._game.getBoard();
        const lm       = this._game.lastMove;
        const kingPos  = this._findCheckKing();

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
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
                    const pl = this._assignments[r][c];

                    if (pl) {
                        const name = document.createElement('div');
                        name.className = 'piece-name';
                        name.textContent = pl.username;
                        cell.appendChild(name);
                    }

                    const sym = document.createElement('div');
                    sym.className = 'piece-symbol';
                    sym.id = `sym-${r}-${c}`;
                    sym.appendChild(pieceImg(p.color, p.type));
                    cell.appendChild(sym);

                    if (pl?.lastMsg) {
                        const msg = document.createElement('div');
                        msg.className = 'piece-msg';
                        msg.id = `msg-${r}-${c}`;
                        msg.textContent = pl.displayMsg ?? pl.lastMsg;
                        cell.appendChild(msg);
                    }

                    if (isLegal) {
                        const ring = document.createElement('div');
                        ring.className = 'capture-ring';
                        cell.appendChild(ring);
                    }
                } else if (isLegal) {
                    const dot = document.createElement('div');
                    dot.className = 'move-dot';
                    cell.appendChild(dot);
                }

                if (c === 0) {
                    const rank = document.createElement('span');
                    rank.className = 'coords rank';
                    rank.textContent = 8 - r;
                    cell.appendChild(rank);
                }
                if (r === 7) {
                    const file = document.createElement('span');
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
window.pieceImg   = pieceImg;
window.PIECE_IMGS = PIECE_IMGS;
