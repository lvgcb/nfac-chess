import { createFileRoute } from "@tanstack/react-router";
import { ChessBoard } from "@/components/ChessBoard";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Chess vs AI — Play Chess Online" },
      { name: "description", content: "Play chess against an AI opponent, earn coins, and redeem real-world rewards." },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <ChessBoard />
      </main>
    </div>
  );
}
