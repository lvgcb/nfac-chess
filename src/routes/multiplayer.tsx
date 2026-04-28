import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square, type Color, type PieceSymbol } from "chess.js";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/multiplayer")({
  component: MultiplayerPage,
  head: () => ({
    meta: [
      { title: "Multiplayer Chess — Play vs Real Players" },
      { name: "description", content: "Join the matchmaking queue and play live chess against random opponents. Win 10 coins, lose 10 coins." },
    ],
  }),
});

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

type Match = {
  id: string;
  white_id: string;
  black_id: string;
  white_name: string | null;
  black_name: string | null;
  fen: string;
  moves: string[];
  status: string;
  result: string | null;
  winner_id: string | null;
};

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

function MultiplayerPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background"><Header /><main className="p-8 text-center text-muted-foreground">Loading…</main></div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-md mx-auto p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">Multiplayer</h1>
          <p className="text-muted-foreground">Sign in to play live chess against other players.</p>
          <Link to="/auth" className="inline-block px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium">Sign in</Link>
        </main>
      </div>
    );
  }
  return <MultiplayerInner userId={user.id} />;
}

function MultiplayerInner({ userId }: { userId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [queued, setQueued] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume any active match on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("*")
        .eq("status", "active")
        .or(`white_id.eq.${userId},black_id.eq.${userId}`)
        .maybeSingle();
      if (!cancelled && data) setMatch(data as Match);
      const { data: q } = await supabase
        .from("matchmaking_queue").select("user_id").eq("user_id", userId).maybeSingle();
      if (!cancelled && q) setQueued(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Realtime: detect match creation while in queue, and updates while playing
  useEffect(() => {
    const ch = supabase
      .channel(`mp-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, (payload) => {
        const m = payload.new as Match;
        if (m.white_id === userId || m.black_id === userId) {
          setMatch(m);
          setQueued(false);
          setSearching(false);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" }, (payload) => {
        const m = payload.new as Match;
        if (m.white_id === userId || m.black_id === userId) {
          setMatch((prev) => (prev && prev.id !== m.id ? prev : m));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const joinQueue = useCallback(async () => {
    setError(null);
    setSearching(true);
    const { data, error: e } = await supabase.rpc("join_matchmaking");
    if (e) {
      setError(e.message);
      setSearching(false);
      return;
    }
    if (data) {
      const { data: m } = await supabase.from("matches").select("*").eq("id", data as string).maybeSingle();
      if (m) {
        setMatch(m as Match);
        setSearching(false);
      }
    } else {
      setQueued(true);
    }
  }, []);

  const leaveQueue = useCallback(async () => {
    await supabase.from("matchmaking_queue").delete().eq("user_id", userId);
    setQueued(false);
    setSearching(false);
  }, [userId]);

  const handleNewMatch = useCallback(async () => {
    setMatch(null);
    setError(null);
    // Auto-join queue for the next match
    await joinQueue();
  }, [joinQueue]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Multiplayer Chess</h1>
          <p className="text-sm text-muted-foreground">Win <span className="font-semibold text-accent-foreground">+10 🪙</span> · Lose <span className="font-semibold text-destructive">-10 🪙</span></p>
        </div>

        {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm text-center">{error}</div>}

        {!match && (
          <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4">
            {queued || searching ? (
              <>
                <div className="text-4xl animate-pulse">🔍</div>
                <h2 className="text-lg font-semibold">Searching for an opponent…</h2>
                <p className="text-sm text-muted-foreground">Hang tight — you'll be matched as soon as another player joins.</p>
                <button onClick={leaveQueue} className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground hover:opacity-90">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div className="text-4xl">♞</div>
                <h2 className="text-lg font-semibold">Ready to play?</h2>
                <p className="text-sm text-muted-foreground">Join the queue to be paired with a random opponent.</p>
                <button onClick={joinQueue} className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90">
                  Find match
                </button>
              </>
            )}
          </div>
        )}

        {match && (
          <LiveBoard match={match} userId={userId} onNewMatch={handleNewMatch} onMatchUpdate={setMatch} />
        )}
      </main>
    </div>
  );
}

function LiveBoard({
  match,
  userId,
  onNewMatch,
  onMatchUpdate,
}: {
  match: Match;
  userId: string;
  onNewMatch: () => void;
  onMatchUpdate: (m: Match) => void;
}) {
  const isWhite = match.white_id === userId;
  const myColor: Color = isWhite ? "w" : "b";
  const opponentName = (isWhite ? match.black_name : match.white_name) || "Opponent";
  const myName = (isWhite ? match.white_name : match.black_name) || "You";

  const game = useMemo(() => {
    const g = new Chess();
    try { g.load(match.fen); } catch { /* ignore */ }
    return g;
  }, [match.fen]);

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [busy, setBusy] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [view, setView] = useState<"board" | "analysis">("board");
  const finishedRef = useRef(false);

  const turn = game.turn();
  const myTurn = turn === myColor && match.status === "active";
  const finished = match.status === "finished";

  // Show end-game modal when match transitions to finished
  useEffect(() => {
    if (finished && view === "board") setShowEndModal(true);
  }, [finished, view]);

  // Detect game over and settle once
  useEffect(() => {
    if (match.status !== "active") return;
    if (finishedRef.current) return;
    let result: "white" | "black" | "draw" | null = null;
    if (game.isCheckmate()) {
      result = turn === "w" ? "black" : "white";
    } else if (game.isStalemate() || game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) {
      result = "draw";
    }
    if (result) {
      finishedRef.current = true;
      void supabase.rpc("finish_match", { _match_id: match.id, _result: result });
    }
  }, [game, match.id, match.status, turn]);

  const onSquareClick = useCallback(async (sq: Square) => {
    if (!myTurn || busy) return;
    if (selected) {
      if (legalTargets.includes(sq)) {
        setBusy(true);
        const tmp = new Chess(match.fen);
        try {
          const mv = tmp.move({ from: selected, to: sq, promotion: "q" });
          if (mv) {
            const { error: e } = await supabase.rpc("make_match_move", {
              _match_id: match.id,
              _fen: tmp.fen(),
              _move_san: mv.san,
            });
            if (!e) {
              onMatchUpdate({ ...match, fen: tmp.fen(), moves: [...match.moves, mv.san] });
            }
          }
        } catch { /* illegal */ }
        setSelected(null);
        setLegalTargets([]);
        setBusy(false);
        return;
      }
      setSelected(null);
      setLegalTargets([]);
    }
    const piece = game.get(sq);
    if (piece && piece.color === myColor) {
      const moves = game.moves({ square: sq, verbose: true });
      setSelected(sq);
      setLegalTargets(moves.map((m) => m.to as Square));
    }
  }, [myTurn, busy, selected, legalTargets, match, game, myColor, onMatchUpdate]);

  const resign = useCallback(async () => {
    if (match.status !== "active") return;
    if (!confirm("Resign this match? You'll lose 10 coins.")) return;
    finishedRef.current = true;
    const result = isWhite ? "black" : "white";
    await supabase.rpc("finish_match", { _match_id: match.id, _result: result });
  }, [match, isWhite]);

  const ranks = isWhite ? RANKS : ([...RANKS].reverse() as readonly number[]);
  const files = isWhite ? FILES : ([...FILES].reverse() as readonly string[]);

  let resultText = "";
  if (finished) {
    if (match.result === "draw") resultText = "Draw — no coins exchanged.";
    else if (match.winner_id === userId) resultText = "You won! +10 🪙";
    else resultText = "You lost. -10 🪙";
  }

  if (view === "analysis") {
    return (
      <AnalysisView
        match={match}
        userId={userId}
        resultText={resultText}
        onPlayAgain={onNewMatch}
        onBackToBoard={() => setView("board")}
      />
    );
  }

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="font-semibold text-foreground">{opponentName}</div>
          <div className="text-xs text-muted-foreground">Plays {isWhite ? "Black" : "White"}</div>
        </div>
        <div className="text-center">
          {finished ? (
            <span className="px-3 py-1 rounded-full bg-accent/30 text-accent-foreground font-semibold">Game over</span>
          ) : myTurn ? (
            <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground font-semibold">Your turn</span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground">Opponent's turn</span>
          )}
        </div>
        <div className="text-right">
          <div className="font-semibold text-foreground">{myName} (you)</div>
          <div className="text-xs text-muted-foreground">Plays {isWhite ? "White" : "Black"}</div>
        </div>
      </div>

      <div className="mx-auto" style={{ maxWidth: 560 }}>
        <div className="grid grid-cols-8 gap-0 border border-border rounded-md overflow-hidden shadow">
          {ranks.map((rank) =>
            files.map((file) => {
              const sq = `${file}${rank}` as Square;
              const piece = game.get(sq);
              const isLight = (FILES.indexOf(file as typeof FILES[number]) + rank) % 2 === 1;
              const isSel = selected === sq;
              const isTarget = legalTargets.includes(sq);
              return (
                <button
                  key={sq}
                  onClick={() => onSquareClick(sq)}
                  className="relative aspect-square flex items-center justify-center text-3xl sm:text-4xl select-none transition-colors"
                  style={{
                    background: isSel
                      ? "hsl(var(--primary) / 0.4)"
                      : isLight
                      ? "var(--board-light, #f0d9b5)"
                      : "var(--board-dark, #b58863)",
                  }}
                >
                  {piece ? <span>{PIECES[piece.color][piece.type]}</span> : null}
                  {isTarget && (
                    <span className="absolute w-3 h-3 rounded-full bg-primary/70" />
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {!finished && (
          <button onClick={resign} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:opacity-90 text-sm font-medium">
            Resign
          </button>
        )}
        {finished && !showEndModal && (
          <button onClick={() => setShowEndModal(true)} className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground hover:opacity-90 text-sm font-medium">
            Show result
          </button>
        )}
      </div>

      {match.moves.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground mb-1">Moves</div>
          <div className="font-mono text-xs leading-relaxed break-words">
            {match.moves.map((m, i) => (
              <span key={i} className="mr-2">{i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {m}</span>
            ))}
          </div>
        </div>
      )}

      {showEndModal && finished && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-5 text-center">
            <div className="text-5xl">
              {match.result === "draw" ? "🤝" : match.winner_id === userId ? "🏆" : "😞"}
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {match.result === "draw" ? "It's a draw" : match.winner_id === userId ? "Victory!" : "Defeat"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{resultText}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => { setShowEndModal(false); onNewMatch(); }}
                className="flex-1 px-4 py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90"
              >
                Play again
              </button>
              <button
                onClick={() => { setShowEndModal(false); setView("analysis"); }}
                className="flex-1 px-4 py-2.5 rounded-md bg-secondary text-secondary-foreground font-semibold hover:opacity-90"
              >
                See AI analysis
              </button>
            </div>
            <button
              onClick={() => setShowEndModal(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisView({
  match,
  userId,
  resultText,
  onPlayAgain,
  onBackToBoard,
}: {
  match: Match;
  userId: string;
  resultText: string;
  onPlayAgain: () => void;
  onBackToBoard: () => void;
}) {
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  // Build PGN locally from moves
  const pgn = useMemo(() => {
    const g = new Chess();
    for (const san of match.moves) {
      try { g.move(san); } catch { /* skip */ }
    }
    return g.pgn();
  }, [match.moves]);

  // Reconstruct FEN at each step
  const fenAtStep = useMemo(() => {
    const g = new Chess();
    const fens = [g.fen()];
    for (const san of match.moves) {
      try { g.move(san); fens.push(g.fen()); } catch { /* skip */ }
    }
    return fens;
  }, [match.moves]);

  const isWhite = match.white_id === userId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const result =
          match.result === "draw"
            ? "Draw"
            : match.winner_id
              ? `${match.result === "white" ? "White" : "Black"} wins`
              : "Unfinished";
        const { data, error } = await supabase.functions.invoke("analyze-game", {
          body: { pgn, moves: match.moves, result },
        });
        if (cancelled) return;
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        setAnalysis(data as CoachAnalysis);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to analyze");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pgn, match.moves, match.result, match.winner_id]);

  const currentFen = fenAtStep[Math.min(step, fenAtStep.length - 1)] ?? new Chess().fen();
  const board = useMemo(() => {
    const g = new Chess();
    try { g.load(currentFen); } catch { /* ignore */ }
    return g;
  }, [currentFen]);

  const ranks = isWhite ? RANKS : ([...RANKS].reverse() as readonly number[]);
  const files = isWhite ? FILES : ([...FILES].reverse() as readonly string[]);

  const currentMove = analysis && step > 0 ? analysis.moves[step - 1] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-foreground">AI Coach Analysis</h2>
        <div className="flex gap-2">
          <button onClick={onBackToBoard} className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm hover:opacity-90">
            Back to board
          </button>
          <button onClick={onPlayAgain} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90">
            Play again
          </button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground text-center">{resultText}</div>

      <div className="mx-auto" style={{ maxWidth: 480 }}>
        <div className="grid grid-cols-8 gap-0 border border-border rounded-md overflow-hidden shadow">
          {ranks.map((rank) =>
            files.map((file) => {
              const sq = `${file}${rank}` as Square;
              const piece = board.get(sq);
              const isLight = (FILES.indexOf(file as typeof FILES[number]) + rank) % 2 === 1;
              return (
                <div
                  key={sq}
                  className="relative aspect-square flex items-center justify-center text-2xl sm:text-3xl select-none"
                  style={{ background: isLight ? "var(--board-light, #f0d9b5)" : "var(--board-dark, #b58863)" }}
                >
                  {piece ? <span>{PIECES[piece.color][piece.type]}</span> : null}
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-xs text-muted-foreground">
          {step} / {match.moves.length}
        </span>
        <button
          onClick={() => setStep((s) => Math.min(match.moves.length, s + 1))}
          disabled={step >= match.moves.length}
          className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      {loading && (
        <div className="text-center text-sm text-muted-foreground py-4">Analyzing your game…</div>
      )}
      {err && (
        <div className="text-center text-sm text-destructive py-4">{err}</div>
      )}

      {analysis && (
        <>
          <div className="rounded-md border border-border bg-card p-3 text-sm text-foreground">
            <div className="font-semibold mb-1">Summary</div>
            <p className="text-muted-foreground">{analysis.summary}</p>
          </div>

          {currentMove && (
            <div className={`rounded-md border p-3 text-sm ${currentMove.isKey ? "border-accent bg-accent/10" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-foreground">
                  {currentMove.moveNumber}. {currentMove.color === "white" ? "" : "…"}{currentMove.san}
                  {currentMove.isKey && <span className="ml-2 text-xs text-accent-foreground">★ Key move</span>}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  currentMove.quality === "brilliant" || currentMove.quality === "best"
                    ? "bg-primary/20 text-primary"
                    : currentMove.quality === "good"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-destructive/20 text-destructive"
                }`}>
                  {currentMove.quality}
                </span>
              </div>
              <p className="text-muted-foreground">{currentMove.explanation}</p>
              {currentMove.betterMove && (
                <p className="mt-1 text-xs text-foreground">
                  💡 Better: <span className="font-mono font-semibold">{currentMove.betterMove}</span>
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border border-border bg-card p-3 max-h-64 overflow-y-auto">
            <div className="font-semibold text-foreground text-sm mb-2">All moves</div>
            <div className="grid grid-cols-1 gap-1 text-sm">
              {analysis.moves.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i + 1)}
                  className={`text-left px-2 py-1 rounded ${step === i + 1 ? "bg-secondary" : "hover:bg-secondary/50"} ${m.isKey ? "border-l-2 border-accent" : ""}`}
                >
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {m.moveNumber}.{m.color === "black" ? ".." : ""}
                  </span>
                  <span className="font-semibold text-foreground">{m.san}</span>
                  {m.isKey && <span className="ml-2 text-xs text-accent-foreground">★</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
