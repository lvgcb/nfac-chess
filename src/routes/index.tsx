import { createFileRoute } from "@tanstack/react-router";
import { ChessBoard } from "@/components/ChessBoard";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Chess vs AI — Play Chess Online" },
      { name: "description", content: "Play chess against an AI opponent with three difficulty levels right in your browser." },
    ],
  }),
});

function Index() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <ChessBoard />
    </main>
  );
}
