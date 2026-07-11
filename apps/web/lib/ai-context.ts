import type { HabitWithFrequency, StreakRow, CompletionRow } from "@sisigo/types";
import { weeklyConsistencyScore, completionRate, generateInsights } from "@sisigo/utils";

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Great";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Just getting started";
}

export function buildCoachSystemPrompt(
  habits: HabitWithFrequency[],
  streaks: StreakRow[],
  completions: CompletionRow[]
): string {
  const active = habits.filter((h) => !h.is_archived);
  const score = weeklyConsistencyScore(habits, completions);
  const streakMap = new Map(streaks.map((s) => [s.habit_id, s]));
  const insights = generateInsights(active, completions, streaks);

  const habitLines = active
    .map((h) => {
      const s = streakMap.get(h.id);
      const rate = completionRate(
        completions.filter((c) => c.habit_id === h.id),
        h.frequency,
        30
      );
      const streakStr = s?.current_streak ? `${s.current_streak}-day streak` : "no current streak";
      const bestStr = s?.longest_streak ? `, best ever ${s.longest_streak}d` : "";
      return `  ${h.icon} "${h.title}" — ${streakStr}${bestStr}, ${rate}% completion last 30 days`;
    })
    .join("\n");

  const insightLines = insights
    .slice(0, 3)
    .map((i) => `  • ${i.title}: ${i.body}`)
    .join("\n");

  const totalCompletions = completions.length;

  return `You are sisiGo AI — a warm, specific, and encouraging habit coach built into the sisiGo app.

The user's current habit data:
Active habits (${active.length}):
${habitLines || "  (no active habits yet)"}

Weekly consistency score: ${score}/100 (${scoreLabel(score)})
Total completions tracked: ${totalCompletions}

Key insights about this user:
${insightLines || "  • Just getting started with habit tracking"}

Your coaching style:
- Always reference the user's actual habit names, streaks, and data — never be generic
- Be warm, direct, and concise (2–4 short paragraphs unless asked for more)
- When the user is struggling, acknowledge it then give one concrete, specific action
- When asked for habit suggestions, give 3 ideas that complement their existing habits
- Celebrate wins genuinely — reference their specific streak numbers
- Never say "I cannot" — always give your best advice
- Use plain language, no markdown headers or bullet lists in your replies (write in flowing prose)`;
}

export function buildJournalPromptSystem(
  habits: HabitWithFrequency[],
  completions: CompletionRow[],
  todayCompletedIds: Set<string>
): string {
  const active = habits.filter((h) => !h.is_archived);
  const todayDone = active.filter((h) => todayCompletedIds.has(h.id));
  const todayMissed = active.filter(
    (h) => !todayCompletedIds.has(h.id) && active.includes(h)
  );
  const score = weeklyConsistencyScore(habits, completions);

  return `You are a journaling prompt generator for sisiGo, a habit tracking app.

Today's habit data:
- Completed today: ${todayDone.map((h) => `${h.icon} ${h.title}`).join(", ") || "none yet"}
- Not yet done: ${todayMissed.map((h) => `${h.icon} ${h.title}`).join(", ") || "all done!"}
- Weekly consistency score: ${score}/100

Generate ONE thoughtful, personal journal prompt (1–2 sentences) that:
- References the user's actual habits by name
- Is introspective and emotionally honest
- Encourages reflection on why habits succeed or struggle
- Is NOT a yes/no question — invite genuine reflection

Return ONLY the prompt text, nothing else.`;
}

export function buildHabitSuggestionsSystem(existingHabits: HabitWithFrequency[]): string {
  const names = existingHabits
    .filter((h) => !h.is_archived)
    .map((h) => `${h.icon} ${h.title}`)
    .join(", ");

  return `You are a habit coach helping a user expand their habit practice in sisiGo.

Their current habits: ${names || "none yet — this is a brand new user"}

Suggest exactly 3 new habits that would complement what they're already doing. For each habit:
- Choose a relevant emoji
- Give a short name (2-4 words)
- Write one sentence explaining why it pairs well with their existing habits

Return ONLY valid JSON in this exact format, nothing else:
[
  { "icon": "🧘", "title": "Morning Meditation", "reason": "Pairs with your exercise habit to build mental resilience." },
  { "icon": "📖", "title": "Evening Reading", "reason": "Winds down the day after your productivity habits." },
  { "icon": "💧", "title": "Drink 8 Glasses", "reason": "Supports your fitness goals with better hydration." }
]`;
}
