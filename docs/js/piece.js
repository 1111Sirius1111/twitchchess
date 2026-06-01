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
    k: { left: { x: 35,   y: 50   }, right: { x: 67,   y: 50   } },
    q: { left: { x: 32,   y: 21.6 }, right: { x: 68,   y: 21.6 } },
    r: { left: { x: 45,   y: 49   }, right: { x: 56,   y: 49   } },
    b: { left: { x: 42,   y: 35   }, right: { x: 58,   y: 35   } },
    n: { left: { x: 34,   y: 36   }, right: { x: 46,   y: 36   } },
    p: { left: { x: 43.5, y: 45   }, right: { x: 56.5, y: 45   } },
};

// Max pupil offset in SVG units from resting position (3,2).
// Iris r=16, pupil r=7 → max safe offset from center = 9; we use 5 for subtlety.
const PUPIL_MAX = 5;
const PUPIL_REST_X = 3;
const PUPIL_REST_Y = 2;

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

function buildEyeSvg() {
    const ns  = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');

    const sclera = document.createElementNS(ns, 'circle');
    sclera.setAttribute('cx', '18'); sclera.setAttribute('cy', '18');
    sclera.setAttribute('r', '16');  sclera.setAttribute('fill', 'white');
    sclera.setAttribute('stroke', '#333'); sclera.setAttribute('stroke-width', '1.5');

    // pupil group — translate this to aim the eye
    const g = document.createElementNS(ns, 'g');
    g.style.transform  = `translate(${PUPIL_REST_X}px, ${PUPIL_REST_Y}px)`;
    g.style.transition = 'transform 0.18s ease-out';

    const pupil = document.createElementNS(ns, 'circle');
    pupil.setAttribute('cx', '18'); pupil.setAttribute('cy', '18');
    pupil.setAttribute('r', '7');   pupil.setAttribute('fill', '#222');

    const highlight = document.createElementNS(ns, 'circle');
    highlight.setAttribute('cx', '21'); highlight.setAttribute('cy', '14');
    highlight.setAttribute('r', '3');   highlight.setAttribute('fill', 'white');

    g.appendChild(pupil);
    g.appendChild(highlight);
    svg.appendChild(sclera);
    svg.appendChild(g);

    return { svg, g };
}

class Piece {
    constructor(color, type) {
        this.color  = color;
        this.type   = type;
        this.player = null;
        this.el     = null;
        this.innerEl = null;
        this.msgEl  = null;

        this._pos          = null;   // { r, c } on the board
        this._pupilGroups  = [];     // <g> elements to animate
        this._idleTimer    = null;
        this._gazeResetTimer = null;
        this._gazeUntil    = 0;      // timestamp: don't idle-override until after this

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

    setPlayer(pl)   { this.player = pl; }
    setType(type)   { this.type   = type; }
    setPosition(r, c) { this._pos = { r, c }; }

    // Aim eyes in normalized direction (ndx, ndy). holdMs > 0 auto-resets after that time.
    lookAt(ndx, ndy, holdMs = 0) {
        clearTimeout(this._gazeResetTimer);
        const tx = PUPIL_REST_X + ndx * PUPIL_MAX;
        const ty = PUPIL_REST_Y + ndy * PUPIL_MAX;
        for (const g of this._pupilGroups) {
            g.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
        }
        if (holdMs > 0) {
            this._gazeUntil      = Date.now() + holdMs;
            this._gazeResetTimer = setTimeout(() => this.resetGaze(), holdMs);
        }
    }

    // Aim eyes toward a board square. holdMs controls how long to hold before auto-reset.
    lookAtSquare(tr, tc, holdMs = 2000) {
        if (!this._pos) return;
        const dx  = tc - this._pos.c;
        const dy  = tr - this._pos.r;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) return; // same square — use lookAtPixel instead
        this.lookAt(dx / len, dy / len, holdMs);
    }

    // Aim eyes toward a pixel position on the board (relative to board top-left).
    // Used when the cursor is on the same square as this piece.
    // No reset timer — cursor presence holds the gaze; mouseleave/square-change releases it.
    lookAtPixel(relX, relY, cellW, cellH) {
        if (!this._pos) return;
        const cx  = (this._pos.c + 0.5) * cellW;
        const cy  = (this._pos.r + 0.5) * cellH;
        const dx  = relX - cx;
        const dy  = relY - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        clearTimeout(this._gazeResetTimer);
        const tx = PUPIL_REST_X + (dx / len) * PUPIL_MAX;
        const ty = PUPIL_REST_Y + (dy / len) * PUPIL_MAX;
        for (const g of this._pupilGroups) {
            g.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
        }
        this._gazeUntil = Infinity; // held until cursor leaves
    }

    isOnSquare(r, c) { return this._pos?.r === r && this._pos?.c === c; }

    // Selected piece looks toward the enemy half of the board.
    lookForward() {
        this.lookAt(0, this.color === 'white' ? -1 : 1, 2000);
    }

    resetGaze() {
        clearTimeout(this._gazeResetTimer);
        this._gazeUntil = 0;
        for (const g of this._pupilGroups) {
            g.style.transform = `translate(${PUPIL_REST_X}px, ${PUPIL_REST_Y}px)`;
        }
    }

    startIdle() {
        // stagger start so pieces don't all wander in sync
        setTimeout(() => this._idleTick(), Math.random() * 3000);
    }

    _idleTick() {
        // don't override an event-driven look that's still holding
        if (Date.now() < this._gazeUntil) {
            this._idleTimer = setTimeout(
                () => this._idleTick(),
                Math.max(200, this._gazeUntil - Date.now() + 150)
            );
            return;
        }
        const angle = Math.random() * Math.PI * 2;
        const dist  = 0.3 + Math.random() * 0.7;
        const hold  = 600 + Math.random() * 500;
        this.lookAt(Math.cos(angle) * dist, Math.sin(angle) * dist, hold);
        this._idleTimer = setTimeout(() => this._idleTick(), hold + 2000 + Math.random() * 3500);
    }

    redraw() {
        const wrap     = document.createElement('div');
        wrap.className = 'piece-symbol';

        const inner     = document.createElement('div');
        inner.className = 'piece-inner';

        const img = document.createElement('img');
        img.src       = PIECE_IMGS[this.color][this.type];
        img.draggable = false;
        inner.appendChild(img);

        // rebuild pupil group references for the new DOM nodes
        this._pupilGroups = [];
        const coords = EYE_COORDS[this.type];
        if (coords) {
            for (const side of ['left', 'right']) {
                const eye     = document.createElement('div');
                eye.className = 'piece-eye';
                eye.style.left = coords[side].x + '%';
                eye.style.top  = coords[side].y + '%';

                const { svg, g } = buildEyeSvg();
                eye.appendChild(svg);
                inner.appendChild(eye);
                this._pupilGroups.push(g);
            }
            // restore current gaze direction onto freshly created pupils
            this._restoreGaze();
        }

        wrap.appendChild(inner);
        this.el      = wrap;
        this.innerEl = inner;

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
        clearTimeout(this._gazeResetTimer);
        clearTimeout(this._idleTimer);
        this.msgEl?.remove();
    }

    // Re-apply the current gaze offset to freshly built pupil groups after a redraw.
    _restoreGaze() {
        if (!this._pupilGroups.length) return;
        const elapsed = this._gazeUntil - Date.now();
        if (elapsed > 0 && this._pupilGroups[0]) {
            // keep whatever transform was last set by reading _gazeResetTimer existence
            // simplest: just leave the default resting transform; the next lookAt will correct it
        }
        // resting transform is already set by buildEyeSvg, nothing to do unless holding a gaze
    }

    _startSpeaking(text, utterance) {
        clearTimeout(this._msgTimer);
        this._lastMsg    = text;
        this._displayMsg = text;
        this._pageIndex  = 0;

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
            if (!this.innerEl) return;

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

function pieceImg(color, type, size = null) {
    const img = document.createElement('img');
    img.src       = PIECE_IMGS[color][type];
    img.draggable = false;
    if (size !== null) img.style.width = img.style.height = size + 'px';
    return img;
}

window.Piece        = Piece;
window.PIECE_IMGS   = PIECE_IMGS;
window.EYE_COORDS   = EYE_COORDS;
window.pieceImg     = pieceImg;
window.buildEyeSvg  = buildEyeSvg;
