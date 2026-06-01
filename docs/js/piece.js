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

// Eye coordinates (% of piece-symbol dimensions). Paste output from eye-adjustment tool here.
const EYE_COORDS = {
  "k": { "left": { "x": 35, "y": 50 }, "right": { "x": 67, "y": 50 } },
  "q": { "left": { "x": 32, "y": 21.6 }, "right": { "x": 68, "y": 21.6 } },
  "r": { "left": { "x": 45, "y": 49 }, "right": { "x": 56,   "y": 49 } },
  "b": { "left": { "x": 42, "y": 35 }, "right": { "x": 58, "y": 35 } },
  "n": { "left": { "x": 34, "y": 36 }, "right": { "x": 46, "y": 36 } },
  "p": { "left": { "x": 43.5, "y": 45 }, "right": { "x": 56.5, "y": 45 } }
};


const EYE_SVG = '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="16" fill="white" stroke="#333" stroke-width="1.5"/><circle cx="21" cy="20" r="7" fill="#222"/><circle cx="24" cy="16" r="3" fill="white"/></svg>';

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

function paginateForElement(text, el) {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const cs     = getComputedStyle(el);
    ctx.font     = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const maxW   = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

    const words = text.split(/\s+/);
    const pages = [];
    let pageWords    = [];
    let pageStartIdx = 0;

    for (let i = 0; i < words.length; i++) {
        const candidate = pageWords.length ? pageWords.join(' ') + ' ' + words[i] : words[i];
        if (ctx.measureText(candidate).width > maxW && pageWords.length > 0) {
            pages.push({ text: pageWords.join(' '), lastWordIdx: pageStartIdx + pageWords.length - 1 });
            pageStartIdx = i;
            pageWords    = [words[i]];
        } else {
            pageWords.push(words[i]);
        }
    }
    if (pageWords.length) pages.push({ text: pageWords.join(' '), lastWordIdx: Infinity });
    return pages.length ? pages : [{ text, lastWordIdx: Infinity }];
}

class Piece {
    constructor(color, type) {
        this.color  = color;
        this.type   = type;
        this.player = null;
        this.el     = null;
        this.msgEl  = null; // lives in the cell, outside this.el, so it doesn't scale

        this._lastMsg    = null;
        this._displayMsg = null;
        this._pages      = [];
        this._pageIndex  = 0;
        this._msgTimer   = null;

        this._onTtsStart = ({ pl, text, utterance }) => {
            if (pl === this.player) this._startSpeaking(text, utterance);
        };
        bus.on('tts:start', this._onTtsStart);
    }

    setPlayer(pl) { this.player = pl; }
    setType(type) { this.type   = type; }

    // Returns this.el (piece-symbol div). If a message is active, also rebuilds
    // this.msgEl so board.js can append it as a sibling after this.el in the cell.
    redraw() {
        const wrap     = document.createElement('div');
        wrap.className = 'piece-symbol';

        // .piece-inner is what gets scaled on TTS — img and eyes are its children
        // so they move together without transform composition artifacts
        const inner     = document.createElement('div');
        inner.className = 'piece-inner';

        const img = document.createElement('img');
        img.src       = PIECE_IMGS[this.color][this.type];
        img.draggable = false;
        inner.appendChild(img);

        const coords = EYE_COORDS[this.type];
        if (coords) {
            for (const side of ['left', 'right']) {
                const eye     = document.createElement('div');
                eye.className = 'piece-eye';
                eye.style.left = coords[side].x + '%';
                eye.style.top  = coords[side].y + '%';
                eye.innerHTML  = EYE_SVG;
                inner.appendChild(eye);
            }
        }

        wrap.appendChild(inner);
        this.el      = wrap;
        this.innerEl = inner;

        // rebuild msgEl for the new render pass
        if (this._lastMsg) {
            this.msgEl           = document.createElement('div');
            this.msgEl.className = 'piece-msg';
            this.msgEl.textContent = this._displayMsg ?? this._lastMsg;
        } else {
            this.msgEl = null;
        }

        return this.el;
    }

    destroy() {
        bus.off('tts:start', this._onTtsStart);
        clearTimeout(this._msgTimer);
        this.msgEl?.remove();
    }

    _startSpeaking(text, utterance) {
        clearTimeout(this._msgTimer);
        this._lastMsg    = text;
        this._displayMsg = text;
        this._pageIndex  = 0;

        // create msgEl as a sibling of this.el inside the cell
        this.msgEl?.remove();
        this.msgEl           = document.createElement('div');
        this.msgEl.className = 'piece-msg';
        this.el?.parentElement?.appendChild(this.msgEl);

        if (this.msgEl) {
            this.msgEl.textContent = text;
            this._pages      = paginateForElement(text, this.msgEl);
            this._displayMsg = this._pages[0].text;
            this.msgEl.textContent = this._displayMsg;
        } else {
            this._pages = [{ text, lastWordIdx: Infinity }];
        }

        const words = text.split(/\s+/);
        let wordIdx = -1;

        utterance.addEventListener('boundary', (e) => {
            if (e.name !== 'word') return;
            wordIdx++;
            if (!this.el) return;

            // scale the inner wrapper only — eyes stay locked to the piece
            this.innerEl.style.transform = `scale(${wordEmphasis(words[wordIdx] || '')})`;
            setTimeout(() => { if (this.innerEl) this.innerEl.style.transform = ''; }, 180);

            const nextIdx = this._pageIndex + 1;
            if (nextIdx < this._pages.length && wordIdx >= this._pages[this._pageIndex].lastWordIdx) {
                this._pageIndex        = nextIdx;
                this._displayMsg       = this._pages[nextIdx].text;
                if (this.msgEl) this.msgEl.textContent = this._displayMsg;
            }
        });

        utterance.addEventListener('end', () => {
            this._msgTimer = setTimeout(() => {
                if (this._lastMsg === text) {
                    this._lastMsg    = null;
                    this._displayMsg = null;
                    this.msgEl?.remove();
                    this.msgEl = null;
                }
            }, 1000);
        });
    }
}

// Backward-compatible helper used by setup screens and promo modal
function pieceImg(color, type, size = null) {
    const img = document.createElement('img');
    img.src       = PIECE_IMGS[color][type];
    img.draggable = false;
    if (size !== null) img.style.width = img.style.height = size + 'px';
    return img;
}

window.Piece      = Piece;
window.PIECE_IMGS = PIECE_IMGS;
window.EYE_COORDS = EYE_COORDS;
window.EYE_SVG    = EYE_SVG;
window.pieceImg   = pieceImg;
