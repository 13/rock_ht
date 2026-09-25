import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getHabits, getStreaks, getLast30DaysCompletions, getProfile } from "@rock_ht/db";
import { buildCoachSystemPrompt } from "@/lib/ai-context";
import { rateLimit } from "@/lib/rate-limit";
import { todayIn } from "@rock_ht/utils";
import type { TypedSupabaseClient } from "@rock_ht/db";

export const runtime = "nodejs";

function asDb(c: unknown): TypedSupabaseClient {
  return c as TypedSupabaseClient;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
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

  const allowed = rateLimit(`ai_coach:${user.id}`, 20, 60 * 60 * 1000) // 20 req/hour
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
  }

  const { messages }: { messages: ChatMessage[] } = await req.json();
  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const db = asDb(supabase);
  const profile = await getProfile(db, user.id).catch(() => null);
  const todayStr = todayIn(profile?.timezone ?? "UTC");

  const [habits, streaks, completions] = await Promise.all([
    getHabits(db, user.id),
    getStreaks(db, user.id),
    getLast30DaysCompletions(db, user.id, todayStr),
  ]);

  const systemPrompt = buildCoachSystemPrompt(habits, streaks, completions);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
