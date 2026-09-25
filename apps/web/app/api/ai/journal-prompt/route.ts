import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getHabits, getLast30DaysCompletions, getTodayCompletions, getProfile } from "@rock_ht/db";
import { buildJournalPromptSystem } from "@/lib/ai-context";
import { rateLimit } from "@/lib/rate-limit";
import { todayIn } from "@rock_ht/utils";
import type { TypedSupabaseClient } from "@rock_ht/db";

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

  const serviceDb = createServiceClient();
  const { data: sub } = await serviceDb.from('subscriptions').select('plan').eq('user_id', user.id).single();
  if (sub?.plan !== 'pro') {
    return Response.json({ error: 'Pro subscription required' }, { status: 403 });
  }

  const allowed = rateLimit(`ai_journal:${user.id}`, 10, 24 * 60 * 60 * 1000) // 10 req/day
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429 })
  }

  const db = asDb(supabase);
  const profile = await getProfile(db, user.id).catch(() => null);
  const todayStr = todayIn(profile?.timezone ?? "UTC");

  const [habits, completions, todayCompletions] = await Promise.all([
    getHabits(db, user.id),
    getLast30DaysCompletions(db, user.id, todayStr),
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
