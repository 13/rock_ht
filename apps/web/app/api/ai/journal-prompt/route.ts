import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getHabits, getLast30DaysCompletions, getTodayCompletions } from "@sisigo/db";
import { buildJournalPromptSystem } from "@/lib/ai-context";
import { rateLimit } from "@/lib/rate-limit";
import { today } from "@sisigo/utils";
import type { TypedSupabaseClient } from "@sisigo/db";

export const runtime = "nodejs";

function asDb(c: unknown): TypedSupabaseClient {
  return c as TypedSupabaseClient;
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = rateLimit(`ai_journal:${user.id}`, 10, 24 * 60 * 60 * 1000) // 10 req/day
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429 })
  }

  const db = asDb(supabase);
  const todayStr = today();

  const [habits, completions, todayCompletions] = await Promise.all([
    getHabits(db, user.id),
    getLast30DaysCompletions(db, user.id),
    getTodayCompletions(db, user.id, todayStr),
  ]);

  const todayCompletedIds = new Set(todayCompletions.map((c) => c.habit_id));
  const systemPrompt = buildJournalPromptSystem(habits, completions, todayCompletedIds);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: "user", content: "Generate a journal prompt for today." }],
  });

  const prompt =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  return Response.json({ prompt });
}
