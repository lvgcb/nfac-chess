import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/shop")({
  component: ShopPage,
  head: () => ({
    meta: [
      { title: "Shop — Chess vs AI" },
      { name: "description", content: "Spend in-game coins on real-world chess gear, electronics and event tickets." },
    ],
  }),
});

type Item = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image_emoji: string;
  in_stock: boolean;
};

function ShopPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [coins, setCoins] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    supabase.from("shop_items").select("*").order("price").then(({ data }) => {
      if (data) setItems(data as Item[]);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("coins").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) setCoins(data.coins);
    });
  }, [user]);

  const buy = async (item: Item) => {
    if (!user) return;
    setBusy(item.id); setMsg(null);
    const { error } = await supabase.rpc("purchase_shop_item", { _item_id: item.id });
    setBusy(null);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      setMsg({ kind: "ok", text: `Order placed for ${item.name}! Check your profile for details.` });
      setCoins((c) => c - item.price);
    }
  };

  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Rewards Shop</h1>
            <p className="text-sm text-muted-foreground mt-1">Spend coins earned from games on real-world items.</p>
          </div>
          {user && (
            <span className="px-3 py-1.5 rounded-full bg-accent/30 text-accent-foreground border border-accent/40 font-semibold text-sm">
              🪙 {coins.toLocaleString()}
            </span>
          )}
        </div>

        {!user && (
          <div className="bg-card border border-border rounded-xl p-4 mb-6 text-sm flex items-center justify-between flex-wrap gap-3">
            <span className="text-card-foreground">Sign in to redeem items.</span>
            <Link to="/auth" className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold">Sign in</Link>
          </div>
        )}

        {msg && (
          <div className={`rounded-xl p-3 mb-4 text-sm border ${msg.kind === "ok" ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
            {msg.text}
          </div>
        )}

        {categories.map((cat) => (
          <section key={cat} className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{cat}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.filter((i) => i.category === cat).map((item) => {
                const canAfford = user && coins >= item.price;
                return (
                  <div key={item.id} className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col">
                    <div className="text-5xl mb-3">{item.image_emoji}</div>
                    <h3 className="font-bold text-card-foreground">{item.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-4 flex-1">{item.description}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-lg text-foreground">🪙 {item.price.toLocaleString()}</span>
                      <button
                        onClick={() => buy(item)}
                        disabled={!user || !canAfford || busy === item.id}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {busy === item.id ? "…" : !user ? "Sign in" : !canAfford ? "Need more 🪙" : "Redeem"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <p className="text-xs text-muted-foreground text-center mt-8">
          Demo catalog — orders are recorded but not actually fulfilled.
        </p>
      </main>
    </div>
  );
}
