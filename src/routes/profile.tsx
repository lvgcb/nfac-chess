import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
  head: () => ({ meta: [{ title: "Profile — Chess vs AI" }] }),
});

type Profile = { display_name: string | null; coins: number; created_at: string };
type Tx = { id: string; amount: number; reason: string; created_at: string };

const COIN_PACKS = [
  { coins: 500, label: "Starter", price: "$0.99" },
  { coins: 2500, label: "Plus", price: "$3.99" },
  { coins: 10000, label: "Pro", price: "$12.99" },
  { coins: 50000, label: "Whale", price: "$49.99" },
];

function ProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const reload = async () => {
    if (!user) return;
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("profiles").select("display_name, coins, created_at").eq("user_id", user.id).maybeSingle(),
      supabase.from("coin_transactions").select("id, amount, reason, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    ]);
    if (p) { setProfile(p as Profile); setName(p.display_name ?? ""); }
    if (t) setTxs(t as Tx[]);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [user]);

  const buyPack = async (pack: typeof COIN_PACKS[number]) => {
    if (!user) return;
    setBusy(pack.label); setMsg(null);
    const { error } = await supabase.rpc("award_coins", {
      _amount: pack.coins,
      _reason: "topup_simulated",
      _metadata: { pack: pack.label, price: pack.price },
    });
    setBusy(null);
    if (error) setMsg(error.message);
    else { setMsg(`+${pack.coins.toLocaleString()} coins added (simulated)`); reload(); }
  };

  const saveName = async () => {
    if (!user) return;
    setBusy("name");
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("user_id", user.id);
    setBusy(null);
    if (!error) { setEditing(false); reload(); }
  };

  if (loading || !user || !profile) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-12 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Profile card */}
        <div className="bg-card border border-border rounded-2xl p-6 flex items-center gap-5 shadow-sm">
          <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
            {(profile.display_name || user.email || "?")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm rounded border border-input bg-background"
                />
                <button onClick={saveName} disabled={busy === "name"} className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground">Save</button>
                <button onClick={() => { setEditing(false); setName(profile.display_name ?? ""); }} className="px-3 py-1 text-xs rounded bg-secondary text-secondary-foreground">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-card-foreground truncate">{profile.display_name || "Player"}</h1>
                <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground underline">edit</button>
              </div>
            )}
            <p className="text-sm text-muted-foreground truncate">{user.email}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Member since {new Date(profile.created_at).toLocaleDateString()}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Balance</p>
            <p className="text-2xl font-bold text-foreground">🪙 {profile.coins.toLocaleString()}</p>
          </div>
        </div>

        {/* Buy coins */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-card-foreground">Buy more coins</h2>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/30 text-accent-foreground border border-accent/40">Simulated</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Demo top-ups — no real payment is taken.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {COIN_PACKS.map((p) => (
              <button
                key={p.label}
                onClick={() => buyPack(p)}
                disabled={busy === p.label}
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-background hover:border-primary/60 hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{p.label}</span>
                <span className="text-xl font-bold text-foreground my-1">🪙 {p.coins.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{p.price}</span>
              </button>
            ))}
          </div>
          {msg && <p className="text-sm text-foreground mt-3">{msg}</p>}
        </div>

        {/* Transactions */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-card-foreground mb-3">Recent activity</h2>
          {txs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coin activity yet — play a game or buy a pack to get started.</p>
          ) : (
            <ul className="divide-y divide-border">
              {txs.map((t) => (
                <li key={t.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <p className="text-foreground capitalize">{t.reason.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                  </div>
                  <span className={`font-mono font-semibold ${t.amount > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {t.amount > 0 ? "+" : ""}{t.amount.toLocaleString()} 🪙
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
