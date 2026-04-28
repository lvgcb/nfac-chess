import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function Header() {
  const { user, signOut } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const linkClass =
    "block w-full text-left px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors";
  const activeLinkClass =
    "block w-full text-left px-3 py-2 rounded-md text-sm text-foreground bg-secondary";

  return (
    <header className="w-full border-b border-border bg-card/60 backdrop-blur sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="font-bold text-foreground tracking-tight text-lg">
          ♞ Chess vs AI
        </Link>

        <div className="flex items-center gap-2">
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

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-9 h-9 rounded-md bg-card border border-border flex flex-col items-center justify-center gap-[3px] hover:bg-secondary transition-colors"
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <span className="block w-4 h-[2px] bg-foreground" />
              <span className="block w-4 h-[2px] bg-foreground" />
              <span className="block w-4 h-[2px] bg-foreground" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card shadow-lg p-2 z-50">
                {user && coins !== null && (
                  <div className="sm:hidden flex items-center justify-between px-3 py-2 mb-1 rounded-md bg-accent/20 text-accent-foreground text-xs font-semibold">
                    <span>Balance</span>
                    <span>🪙 {coins.toLocaleString()}</span>
                  </div>
                )}
                <Link
                  to="/"
                  onClick={() => setMenuOpen(false)}
                  className={linkClass}
                  activeProps={{ className: activeLinkClass }}
                  activeOptions={{ exact: true }}
                >
                  Play AI
                </Link>
                <Link
                  to="/multiplayer"
                  onClick={() => setMenuOpen(false)}
                  className={linkClass}
                  activeProps={{ className: activeLinkClass }}
                >
                  Multiplayer
                </Link>
                <Link
                  to="/shop"
                  onClick={() => setMenuOpen(false)}
                  className={linkClass}
                  activeProps={{ className: activeLinkClass }}
                >
                  Shop
                </Link>
                {user && (
                  <Link
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className={linkClass}
                    activeProps={{ className: activeLinkClass }}
                  >
                    Profile
                  </Link>
                )}
                <div className="my-1 border-t border-border" />
                {user ? (
                  <button
                    onClick={() => { setMenuOpen(false); void signOut(); }}
                    className="block w-full text-left px-3 py-2 rounded-md text-sm bg-secondary text-secondary-foreground hover:opacity-90"
                  >
                    Sign out
                  </button>
                ) : (
                  <Link
                    to="/auth"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full text-left px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
