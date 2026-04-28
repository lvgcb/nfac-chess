import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pgn, moves, result } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a chess coach analyzing a game between a human (White) and an AI opponent (Black).
For EVERY move in the game, provide:
- "moveNumber": move index (1-based, counting both colors)
- "san": the move in standard algebraic notation
- "color": "white" or "black"
- "explanation": one short sentence explaining the idea behind the move
- "quality": one of "brilliant", "best", "good", "inaccuracy", "mistake", "blunder"
- "betterMove": if quality is inaccuracy/mistake/blunder, suggest a better move in SAN; otherwise null
- "isKey": true if this is a critical/turning-point move (opening trap, tactical shot, decisive blunder, mating sequence). Otherwise false.

Also provide a brief "summary" (2-3 sentences) of the overall game.

Return ONLY valid JSON.`;

    const userPrompt = `Game result: ${result}
PGN: ${pgn}
Moves (SAN): ${moves.join(" ")}

Analyze every move.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_analysis",
                description: "Submit the full game analysis",
                parameters: {
                  type: "object",
                  properties: {
                    summary: { type: "string" },
                    moves: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          moveNumber: { type: "number" },
                          san: { type: "string" },
                          color: { type: "string", enum: ["white", "black"] },
                          explanation: { type: "string" },
                          quality: {
                            type: "string",
                            enum: [
                              "brilliant",
                              "best",
                              "good",
                              "inaccuracy",
                              "mistake",
                              "blunder",
                            ],
                          },
                          betterMove: { type: ["string", "null"] },
                          isKey: { type: "boolean" },
                        },
                        required: [
                          "moveNumber",
                          "san",
                          "color",
                          "explanation",
                          "quality",
                          "isKey",
                        ],
                      },
                    },
                  },
                  required: ["summary", "moves"],
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "submit_analysis" },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No analysis returned");
    const analysis = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-game error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
