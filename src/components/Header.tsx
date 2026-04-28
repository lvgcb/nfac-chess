import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function Header() {
  const { user, signOut } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem("theme") as "light" | "dark" | null) ?? "dark";
      setTheme(saved);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (!user) { setCoins(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("coins")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setCoins(data?.coins ?? 0);
    };
    load();
    const ch = supabase
      .channel(`profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const next = (payload.new as { coins?: number }).coins;
          if (typeof next === "number") setCoins(next);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [user]);

  return (
    <header className="w-full border-b border-border bg-card/60 backdrop-blur sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="font-bold text-foreground tracking-tight text-lg">
          ♞ Chess vs AI
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <Link
            to="/"
            className="px-2 sm:px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            activeProps={{ className: "px-2 sm:px-3 py-1.5 rounded-md text-foreground bg-secondary" }}
            activeOptions={{ exact: true }}
          >
            Play
          </Link>
          <Link
            to="/shop"
            className="px-2 sm:px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            activeProps={{ className: "px-2 sm:px-3 py-1.5 rounded-md text-foreground bg-secondary" }}
          >
            Shop
          </Link>
          {user && (
            <Link
              to="/profile"
              className="px-2 sm:px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              activeProps={{ className: "px-2 sm:px-3 py-1.5 rounded-md text-foreground bg-secondary" }}
            >
              Profile
            </Link>
          )}
          {user && coins !== null && (
            <span
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/30 text-accent-foreground border border-accent/40"
              title="Your coin balance"
            >
              🪙 {coins.toLocaleString()}
            </span>
          )}
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-sm hover:bg-secondary transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          {user ? (
            <button
              onClick={signOut}
              className="px-3 py-1.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:opacity-90"
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/auth"
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
