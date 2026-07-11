import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getHabits } from "@sisigo/db";
import { buildHabitSuggestionsSystem } from "@/lib/ai-context";
import { rateLimit } from "@/lib/rate-limit";
import type { TypedSupabaseClient } from "@sisigo/db";

export const runtime = "nodejs";

function asDb(c: unknown): TypedSupabaseClient {
  return c as TypedSupabaseClient;
}

export interface HabitSuggestion {
  icon: string;
  title: string;
  reason: string;
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

  const allowed = rateLimit(`ai_suggest:${user.id}`, 5, 24 * 60 * 60 * 1000) // 5 req/day
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429 })
  }

  const db = asDb(supabase);
  const habits = await getHabits(db, user.id);
  const systemPrompt = buildHabitSuggestionsSystem(habits);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: "Suggest 3 habits for me." }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "[]";

  let suggestions: HabitSuggestion[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      suggestions = parsed.slice(0, 3).filter(
        (s) => typeof s.icon === "string" && typeof s.title === "string" && typeof s.reason === "string"
      );
    }
  } catch {
    // Return empty if parsing fails
  }

  return Response.json({ suggestions });
}
