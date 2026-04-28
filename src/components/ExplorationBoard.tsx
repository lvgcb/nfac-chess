import { useEffect, useMemo, useState } from "react";
import { Chess, type Square, type Move, type Color, type PieceSymbol } from "chess.js";

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

/** Interactive sandbox board — accepts a starting FEN and lets the user play freely from it. */
export function ExplorationBoard({ fen, resetKey }: { fen: string; resetKey: number }) {
  const [chess, setChess] = useState(() => new Chess(fen));
  const [, force] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Square[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  // Re-init when parent FEN or resetKey changes
  useEffect(() => {
    const c = new Chess(fen);
    setChess(c);
    setSelected(null);
    setTargets([]);
    setHistory([]);
  }, [fen, resetKey]);

  const board = useMemo(() => chess.board(), [chess, history]);

  const onClick = (sq: Square) => {
    if (chess.isGameOver()) return;
    const piece = chess.get(sq);
    if (selected) {
      if (sq === selected) { setSelected(null); setTargets([]); return; }
      if (targets.includes(sq)) {
        const m = chess.move({ from: selected, to: sq, promotion: "q" }) as Move | null;
        if (m) {
          setHistory((h) => [...h, m.san]);
          setSelected(null); setTargets([]);
          force((x) => x + 1);
          return;
        }
      }
      if (piece) {
        setSelected(sq);
        const moves = chess.moves({ square: sq, verbose: true }) as Move[];
        setTargets(moves.map((m) => m.to));
        return;
      }
      setSelected(null); setTargets([]);
      return;
    }
    if (piece) {
      setSelected(sq);
      const moves = chess.moves({ square: sq, verbose: true }) as Move[];
      setTargets(moves.map((m) => m.to));
    }
  };

  const undo = () => { chess.undo(); setHistory((h) => h.slice(0, -1)); setSelected(null); setTargets([]); force((x) => x + 1); };
  const reset = () => { const c = new Chess(fen); setChess(c); setHistory([]); setSelected(null); setTargets([]); };

  const status = chess.isCheckmate()
    ? `Checkmate — ${chess.turn() === "w" ? "Black" : "White"} wins`
    : chess.isStalemate() ? "Stalemate"
    : chess.isDraw() ? "Draw"
    : chess.inCheck() ? `${chess.turn() === "w" ? "White" : "Black"} in check`
    : `${chess.turn() === "w" ? "White" : "Black"} to move`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs text-muted-foreground">Try variations · {status}</div>
      <div
        className="grid grid-cols-8 grid-rows-8 rounded-lg overflow-hidden ring-1 ring-border shadow-md"
        style={{ width: "min(80vw, 360px)", height: "min(80vw, 360px)" }}
      >
        {RANKS.map((rank, r) =>
          FILES.map((file, f) => {
            const sq = (file + rank) as Square;
            const piece = board[r][f];
            const isLight = (r + f) % 2 === 0;
            const isSel = selected === sq;
            const isTarget = targets.includes(sq);
            const hasEnemy = isTarget && piece;
            return (
              <button
                key={sq}
                onClick={() => onClick(sq)}
                className="relative flex items-center justify-center select-none"
                style={{ background: isLight ? "var(--board-light)" : "var(--board-dark)" }}
              >
                {isSel && <div className="absolute inset-0" style={{ background: "var(--board-highlight)" }} />}
                {isTarget && !hasEnemy && (
                  <div className="absolute rounded-full" style={{ width: "28%", height: "28%", background: "var(--board-move)" }} />
                )}
                {hasEnemy && (
                  <div className="absolute inset-1 rounded-full" style={{ boxShadow: "inset 0 0 0 3px var(--board-move)" }} />
                )}
                {piece && (
                  <span
                    className="relative leading-none"
                    style={{
                      fontSize: "min(7vw, 44px)",
                      color: piece.color === "w" ? "#f8f5ec" : "#1a1a1a",
                      textShadow: piece.color === "w"
                        ? "0 1px 0 #000, 0 0 2px rgba(0,0,0,0.6)"
                        : "0 1px 0 #fff3, 0 0 2px rgba(255,255,255,0.2)",
                    }}
                  >
                    {PIECES[piece.color][piece.type]}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={undo} disabled={history.length === 0} className="px-3 py-1 text-xs rounded bg-secondary text-secondary-foreground disabled:opacity-40">Undo</button>
        <button onClick={reset} disabled={history.length === 0} className="px-3 py-1 text-xs rounded bg-secondary text-secondary-foreground disabled:opacity-40">Reset to position</button>
      </div>
      {history.length > 0 && (
        <div className="text-[11px] font-mono text-muted-foreground max-w-[360px] text-center">
          {history.join(" ")}
        </div>
      )}
    </div>
  );
}
