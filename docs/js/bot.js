class Bot {
    constructor(game) {
        this._game = game;

        bus.on('game:moved', () => {
            const chess = game.chess;
            if (!chess || chess.status === 'checkmate' || chess.status === 'stalemate') return;
            if (chess.turn === 'black') {
                setTimeout(() => this._doMove(), 500 + Math.random() * 800);
            }
        });

        bus.on('game:started', () => {
            if (this._game.chess?.turn === 'black') {
                setTimeout(() => this._doMove(), 800);
            }
        });
    }

    _doMove() {
        const chess = this._game.chess;
        if (!chess || chess.status === 'checkmate' || chess.status === 'stalemate') return;
        if (chess.turn !== 'black') return;

        const allMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = chess.getPiece(r, c);
                if (piece && piece.color === 'black') {
                    const targets = chess.getLegalMoves(r, c);
                    for (const [tr, tc] of targets) {
                        allMoves.push({ fr: r, fc: c, tr, tc });
                    }
                }
            }
        }

        if (allMoves.length === 0) return;

        const move  = allMoves[Math.floor(Math.random() * allMoves.length)];
        const piece = chess.getPiece(move.fr, move.fc);

        let promo = 'q';
        const isPawn   = piece?.type === 'p';
        const backRank = move.tr === 0;
        if (isPawn && backRank) promo = 'q';

        this._game.makeMove(move.fr, move.fc, move.tr, move.tc, promo);
    }
}

window.Bot = Bot;