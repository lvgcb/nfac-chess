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
  const [showEndModal, setShowEndModal] = useState(false);
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0); // index into analysis.moves (0 = before any move)
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const playerColor: Color = "w";
  const aiTimer = useRef<number | null>(null);
  const endHandled = useRef(false);

  // Theme init + sync
  useEffect(() => {
    try {
      const saved = (localStorage.getItem("theme") as "light" | "dark" | null) ?? "dark";
      setTheme(saved);
    } catch {/* ignore */}
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("theme", theme); } catch {/* ignore */}
  }, [theme]);

  const liveBoard = useMemo(() => chess.board(), [fen, chess]);
  const inCheck = chess.inCheck();
  const turn = chess.turn();
  const gameOver = chess.isGameOver();

  // Compute analysis-mode position by replaying SAN moves up to analysisStep
  const analysisView = useMemo(() => {
    if (!analysisMode || !analysis) return null;
    const c = new Chess();
    let played: { from: Square; to: Square; san: string } | null = null;
    for (let i = 0; i < analysisStep && i < analysis.moves.length; i++) {
      const m = c.move(analysis.moves[i].san) as Move | null;
      if (!m) break;
      if (i === analysisStep - 1) played = { from: m.from, to: m.to, san: m.san };
    }
    // Compute "better move" arrow if the step's move suggested one
    let better: { from: Square; to: Square; san: string } | null = null;
    if (analysisStep > 0) {
      const cur = analysis.moves[analysisStep - 1];
      if (cur?.betterMove) {
        // Roll back one move to evaluate the better alternative from same position
        const sandbox = new Chess();
        for (let i = 0; i < analysisStep - 1 && i < analysis.moves.length; i++) {
          sandbox.move(analysis.moves[i].san);
        }
        const tryMove = sandbox.move(cur.betterMove) as Move | null;
        if (tryMove) better = { from: tryMove.from, to: tryMove.to, san: tryMove.san };
      }
    }
    return { board: c.board(), played, better, currentMove: analysisStep > 0 ? analysis.moves[analysisStep - 1] : null };
  }, [analysisMode, analysis, analysisStep]);

  const board = analysisView ? analysisView.board : liveBoard;

  const resultText = useMemo(() => {
    if (chess.isCheckmate()) return `Checkmate — ${turn === "w" ? "Black" : "White"} wins`;
    if (chess.isStalemate()) return "Stalemate — Draw";
    if (chess.isDraw()) return "Draw";
    return "Game over";
  }, [fen, chess, turn]);

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
    if (analysisMode || gameOver || thinking || turn !== playerColor) return;
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

  // Trigger end-game modal
  useEffect(() => {
    if (gameOver && !endHandled.current) {
      endHandled.current = true;
      setShowEndModal(true);
    }
  }, [gameOver]);

  const reset = () => {
    chess.reset();
    setFen(chess.fen());
    setSelected(null);
    setLegalTargets([]);
    setLastMove(null);
    setHistory([]);
    setCaptured({ w: [], b: [] });
    setShowEndModal(false);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisMode(false);
    setAnalysisStep(0);
    endHandled.current = false;
  };

  const runAnalysis = async () => {
    setShowEndModal(false);
    setAnalysisMode(true);
    setAnalysisStep(0);
    if (analysis || analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-game", {
        body: {
          pgn: chess.pgn(),
          moves: history,
          result: resultText,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setAnalysis(data as CoachAnalysis);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Failed to analyze game");
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex flex-col items-center px-4 py-6 gap-6">
      {/* Header: title + difficulty (top, centered) + theme toggle */}
      <div className="flex flex-col items-center gap-3 w-full max-w-3xl relative">
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="absolute right-0 top-0 w-9 h-9 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-base hover:bg-secondary transition-colors"
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Chess vs AI</h1>
        <div className="flex items-center gap-1 rounded-full bg-card border border-border p-1 shadow-sm">
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              disabled={analysisMode}
              className="px-4 py-1.5 text-sm font-medium rounded-full transition-colors capitalize disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: difficulty === d ? "var(--primary)" : "transparent",
                color:
                  difficulty === d
                    ? "var(--primary-foreground)"
                    : "var(--muted-foreground)",
              }}
            >
              {d}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {analysisMode
            ? `Analysis · move ${analysisStep}/${analysis?.moves.length ?? "…"}`
            : status}
        </p>
      </div>

      {/* Centered board */}
      <div className="flex flex-col items-center gap-3">
        <div className="text-sm text-muted-foreground font-mono min-h-5">
          Black {captured.w.map((p, i) => <span key={i}>{PIECES.b[p]}</span>)}
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
                    <div className="absolute inset-0" style={{ background: "var(--board-last)" }} />
                  )}
                  {isSelected && (
                    <div className="absolute inset-0" style={{ background: "var(--board-highlight)" }} />
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
                      style={{ width: "30%", height: "30%", background: "var(--board-move)" }}
                    />
                  )}
                  {hasEnemy && (
                    <div
                      className="absolute inset-1 rounded-full"
                      style={{ boxShadow: "inset 0 0 0 4px var(--board-move)" }}
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

        <div className="text-sm text-muted-foreground font-mono min-h-5">
          White {captured.b.map((p, i) => <span key={i}>{PIECES.w[p]}</span>)}
        </div>

        <div className="flex gap-2 mt-2 flex-wrap justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            New Game
          </button>
          <button
            onClick={undo}
            disabled={history.length < 2 || thinking || gameOver}
            className="px-4 py-2 text-sm font-medium rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          {gameOver && (
            <button
              onClick={runAnalysis}
              className="px-4 py-2 text-sm font-medium rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
            >
              {analysis ? "View Analysis" : "Analyze Game"}
            </button>
          )}
        </div>
      </div>

      {/* End-game modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
            <h2 className="text-2xl font-bold text-card-foreground mb-2">Game Over</h2>
            <p className="text-muted-foreground mb-6">{resultText}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={runAnalysis}
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                See Coach Analysis
              </button>
              <button
                onClick={reset}
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity"
              >
                Start New Match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coach analysis modal */}
      {showCoach && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="text-xl font-bold text-card-foreground">AI Coach</h2>
                <p className="text-xs text-muted-foreground">{resultText}</p>
              </div>
              <button
                onClick={() => setShowCoach(false)}
                className="text-muted-foreground hover:text-foreground text-2xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {analysisLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">Coach is reviewing your game…</p>
                </div>
              )}
              {analysisError && !analysisLoading && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md p-4 text-sm">
                  {analysisError}
                  <button
                    onClick={() => { setAnalysis(null); setAnalysisError(null); runAnalysis(); }}
                    className="ml-2 underline"
                  >
                    Retry
                  </button>
                </div>
              )}
              {analysis && (
                <div className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Summary
                    </h3>
                    <p className="text-sm text-card-foreground">{analysis.summary}</p>
                  </div>

                  <div className="space-y-2">
                    {analysis.moves.map((m, i) => {
                      const qColor: Record<CoachMove["quality"], string> = {
                        brilliant: "bg-purple-500/20 text-purple-300 border-purple-500/40",
                        best: "bg-green-500/20 text-green-300 border-green-500/40",
                        good: "bg-blue-500/20 text-blue-300 border-blue-500/40",
                        inaccuracy: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
                        mistake: "bg-orange-500/20 text-orange-300 border-orange-500/40",
                        blunder: "bg-red-500/20 text-red-300 border-red-500/40",
                      };
                      return (
                        <div
                          key={i}
                          className={`rounded-lg p-3 border ${
                            m.isKey
                              ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                              : "border-border bg-background/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">
                                {Math.ceil(m.moveNumber / 2)}.{m.color === "black" ? ".." : ""}
                              </span>
                              <span className="font-mono font-semibold text-card-foreground">
                                {m.san}
                              </span>
                              <span className="text-xs text-muted-foreground capitalize">
                                ({m.color})
                              </span>
                              {m.isKey && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                                  Key
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${qColor[m.quality]}`}
                            >
                              {m.quality}
                            </span>
                          </div>
                          <p className="text-sm text-card-foreground/90">{m.explanation}</p>
                          {m.betterMove && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Better:{" "}
                              <span className="font-mono font-semibold text-foreground">
                                {m.betterMove}
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-border flex gap-2">
              <button
                onClick={reset}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                New Match
              </button>
              <button
                onClick={() => setShowCoach(false)}
                className="px-4 py-2 text-sm font-semibold rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
