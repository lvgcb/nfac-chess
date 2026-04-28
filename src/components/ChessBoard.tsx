import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square, type Move, type Color, type PieceSymbol } from "chess.js";
import { supabase } from "@/integrations/supabase/client";

type CoachMove = {
  moveNumber: number;
  san: string;
  color: "white" | "black";
  explanation: string;
  quality: "brilliant" | "best" | "good" | "inaccuracy" | "mistake" | "blunder";
  betterMove?: string | null;
  isKey: boolean;
};
type CoachAnalysis = { summary: string; moves: CoachMove[] };

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

type Difficulty = "easy" | "medium" | "hard";

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
};

// Piece-square tables (simplified, from white's perspective)
const PST: Record<PieceSymbol, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

function squareToIndex(sq: Square): number {
  const file = sq.charCodeAt(0) - 97;
  const rank = 8 - parseInt(sq[1], 10);
  return rank * 8 + file;
}

function evaluate(chess: Chess): number {
  if (chess.isCheckmate()) return chess.turn() === "w" ? -100000 : 100000;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const idx = r * 8 + f;
      const pstIdx = piece.color === "w" ? idx : (7 - r) * 8 + f;
      const value = PIECE_VALUES[piece.type] + PST[piece.type][pstIdx];
      score += piece.color === "w" ? value : -value;
    }
  }
  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const score = (m: Move) => {
      let s = 0;
      if (m.captured) s += 10 * PIECE_VALUES[m.captured] - PIECE_VALUES[m.piece];
      if (m.promotion) s += 800;
      return s;
    };
    return score(b) - score(a);
  });
}

function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  color: 1 | -1,
): number {
  if (depth === 0 || chess.isGameOver()) {
    return color * evaluate(chess);
  }
  const moves = orderMoves(chess.moves({ verbose: true }) as Move[]);
  let best = -Infinity;
  for (const m of moves) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -beta, -alpha, color === 1 ? -1 : 1);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function chooseAIMove(fen: string, difficulty: Difficulty): Move | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    // 70% random, 30% pick a capture if available
    if (Math.random() < 0.7) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const captures = moves.filter((m) => m.captured);
    const pool = captures.length ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const depth = difficulty === "medium" ? 2 : 3;
  const color = chess.turn() === "w" ? 1 : -1;
  let bestScore = -Infinity;
  let bestMoves: Move[] = [];
  const ordered = orderMoves(moves);
  let alpha = -Infinity;
  const beta = Infinity;
  for (const m of ordered) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -beta, -alpha, color === 1 ? -1 : 1);
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [m];
    } else if (score === bestScore) {
      bestMoves.push(m);
    }
    if (score > alpha) alpha = score;
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

export function ChessBoard() {
  const [chess] = useState(() => new Chess());
  const [fen, setFen] = useState(chess.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [captured, setCaptured] = useState<{ w: PieceSymbol[]; b: PieceSymbol[] }>({ w: [], b: [] });
  const playerColor: Color = "w";
  const aiTimer = useRef<number | null>(null);

  const board = useMemo(() => chess.board(), [fen, chess]);
  const inCheck = chess.inCheck();
  const turn = chess.turn();
  const gameOver = chess.isGameOver();

  const status = useMemo(() => {
    if (chess.isCheckmate()) return `Checkmate — ${turn === "w" ? "Black" : "White"} wins`;
    if (chess.isStalemate()) return "Stalemate";
    if (chess.isDraw()) return "Draw";
    if (chess.isCheck()) return `${turn === "w" ? "White" : "Black"} in check`;
    if (thinking) return "AI is thinking…";
    return turn === playerColor ? "Your move" : "AI's move";
  }, [fen, thinking, turn, chess]);

  const findKingSquare = (color: Color): Square | null => {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === "k" && p.color === color) {
          return (FILES[f] + (8 - r)) as Square;
        }
      }
    }
    return null;
  };
  const checkedKing = inCheck ? findKingSquare(turn) : null;

  const applyMove = useCallback(
    (move: Move) => {
      setLastMove({ from: move.from, to: move.to });
      setFen(chess.fen());
      setHistory((h) => [...h, move.san]);
      if (move.captured) {
        setCaptured((c) => {
          const taker = move.color;
          return {
            ...c,
            [taker]: [...c[taker], move.captured!],
          };
        });
      }
    },
    [chess],
  );

  const handleSquareClick = (sq: Square) => {
    if (gameOver || thinking || turn !== playerColor) return;
    const piece = chess.get(sq);

    if (selected) {
      if (sq === selected) {
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      if (legalTargets.includes(sq)) {
        const move = chess.move({ from: selected, to: sq, promotion: "q" }) as Move | null;
        if (move) {
          applyMove(move);
          setSelected(null);
          setLegalTargets([]);
          return;
        }
      }
      if (piece && piece.color === playerColor) {
        setSelected(sq);
        const moves = chess.moves({ square: sq, verbose: true }) as Move[];
        setLegalTargets(moves.map((m) => m.to));
        return;
      }
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    if (piece && piece.color === playerColor) {
      setSelected(sq);
      const moves = chess.moves({ square: sq, verbose: true }) as Move[];
      setLegalTargets(moves.map((m) => m.to));
    }
  };

  // AI move
  useEffect(() => {
    if (gameOver || turn === playerColor) return;
    setThinking(true);
    aiTimer.current = window.setTimeout(() => {
      const move = chooseAIMove(chess.fen(), difficulty);
      if (move) {
        const made = chess.move(move) as Move;
        applyMove(made);
      }
      setThinking(false);
    }, 250);
    return () => {
      if (aiTimer.current) window.clearTimeout(aiTimer.current);
    };
  }, [fen, turn, gameOver, difficulty, chess, applyMove]);

  const reset = () => {
    chess.reset();
    setFen(chess.fen());
    setSelected(null);
    setLegalTargets([]);
    setLastMove(null);
    setHistory([]);
    setCaptured({ w: [], b: [] });
  };

  const undo = () => {
    if (thinking) return;
    // Undo AI move + player move
    chess.undo();
    chess.undo();
    setFen(chess.fen());
    setSelected(null);
    setLegalTargets([]);
    setLastMove(null);
    setHistory((h) => h.slice(0, Math.max(0, h.length - 2)));
  };

  return (
    <div className="flex flex-col lg:flex-row items-start justify-center gap-8 w-full max-w-6xl mx-auto p-4 lg:p-8">
      {/* Board */}
      <div className="flex flex-col items-center gap-3 flex-shrink-0">
        <div className="flex items-center justify-between w-full px-1">
          <div className="text-sm text-muted-foreground font-mono">
            Black {captured.w.map((p, i) => <span key={i}>{PIECES.b[p]}</span>)}
          </div>
        </div>

        <div
          className="grid grid-cols-8 grid-rows-8 rounded-xl overflow-hidden shadow-2xl ring-1 ring-border"
          style={{
            width: "min(88vw, 560px)",
            height: "min(88vw, 560px)",
          }}
        >
          {RANKS.map((rank, r) =>
            FILES.map((file, f) => {
              const sq = (file + rank) as Square;
              const piece = board[r][f];
              const isLight = (r + f) % 2 === 0;
              const isSelected = selected === sq;
              const isTarget = legalTargets.includes(sq);
              const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
              const isCheck = checkedKing === sq;
              const hasEnemy = isTarget && piece;

              return (
                <button
                  key={sq}
                  onClick={() => handleSquareClick(sq)}
                  className="relative flex items-center justify-center select-none transition-colors"
                  style={{
                    background: isLight ? "var(--board-light)" : "var(--board-dark)",
                    cursor: gameOver || turn !== playerColor ? "default" : "pointer",
                  }}
                >
                  {isLast && (
                    <div
                      className="absolute inset-0"
                      style={{ background: "var(--board-last)" }}
                    />
                  )}
                  {isSelected && (
                    <div
                      className="absolute inset-0"
                      style={{ background: "var(--board-highlight)" }}
                    />
                  )}
                  {isCheck && (
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "radial-gradient(circle, var(--board-check) 0%, transparent 70%)",
                      }}
                    />
                  )}
                  {isTarget && !hasEnemy && (
                    <div
                      className="absolute rounded-full"
                      style={{
                        width: "30%",
                        height: "30%",
                        background: "var(--board-move)",
                      }}
                    />
                  )}
                  {hasEnemy && (
                    <div
                      className="absolute inset-1 rounded-full"
                      style={{
                        boxShadow: "inset 0 0 0 4px var(--board-move)",
                      }}
                    />
                  )}

                  {f === 0 && (
                    <span
                      className="absolute top-0.5 left-1 text-[10px] font-semibold opacity-70"
                      style={{ color: isLight ? "var(--board-dark)" : "var(--board-light)" }}
                    >
                      {rank}
                    </span>
                  )}
                  {r === 7 && (
                    <span
                      className="absolute bottom-0.5 right-1 text-[10px] font-semibold opacity-70"
                      style={{ color: isLight ? "var(--board-dark)" : "var(--board-light)" }}
                    >
                      {file}
                    </span>
                  )}

                  {piece && (
                    <span
                      className="relative leading-none"
                      style={{
                        fontSize: "min(11vw, 70px)",
                        color: piece.color === "w" ? "#f8f5ec" : "#1a1a1a",
                        textShadow:
                          piece.color === "w"
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

        <div className="flex items-center justify-between w-full px-1">
          <div className="text-sm text-muted-foreground font-mono">
            White {captured.b.map((p, i) => <span key={i}>{PIECES.w[p]}</span>)}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-4 w-full lg:w-72 flex-shrink-0">
        <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
          <h1 className="text-xl font-bold tracking-tight text-card-foreground mb-1">
            Chess vs AI
          </h1>
          <p className="text-sm text-muted-foreground mb-4">{status}</p>

          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Difficulty
              </label>
              <div className="grid grid-cols-3 gap-1 mt-1.5">
                {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className="px-2 py-1.5 text-xs font-medium rounded-md transition-colors capitalize"
                    style={{
                      background:
                        difficulty === d ? "var(--primary)" : "var(--secondary)",
                      color:
                        difficulty === d
                          ? "var(--primary-foreground)"
                          : "var(--secondary-foreground)",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={reset}
                className="px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                New Game
              </button>
              <button
                onClick={undo}
                disabled={history.length < 2 || thinking}
                className="px-3 py-2 text-sm font-medium rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Undo
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Move History
          </h2>
          <div className="max-h-72 overflow-y-auto font-mono text-sm space-y-1">
            {history.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">No moves yet</p>
            ) : (
              Array.from({ length: Math.ceil(history.length / 2) }).map((_, i) => (
                <div key={i} className="flex gap-3 text-card-foreground">
                  <span className="text-muted-foreground w-6">{i + 1}.</span>
                  <span className="w-16">{history[i * 2]}</span>
                  <span className="w-16">{history[i * 2 + 1] ?? ""}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
