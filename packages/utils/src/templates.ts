import type { CreateHabitInput } from "@sisigo/types";

export interface HabitTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  frequency: CreateHabitInput["frequency"];
  category: "health" | "mind" | "body" | "growth" | "lifestyle";
}

export const HABIT_TEMPLATES: HabitTemplate[] = [
  {
    id: "morning-run",
    title: "Morning run",
    description: "Start the day with movement",
    icon: "🏃",
    color: "#22c55e",
    frequency: { type: "daily" },
    category: "body",
  },
  {
    id: "drink-water",
    title: "Drink 8 glasses of water",
    description: "Stay hydrated throughout the day",
    icon: "💧",
    color: "#06b6d4",
    frequency: { type: "daily" },
    category: "health",
  },
  {
    id: "meditate",
    title: "Meditate",
    description: "10 minutes of mindfulness",
    icon: "🧘",
    color: "#8b5cf6",
    frequency: { type: "daily" },
    category: "mind",
  },
  {
    id: "read",
    title: "Read for 30 minutes",
    description: "Feed your mind daily",
    icon: "📚",
    color: "#f97316",
    frequency: { type: "daily" },
    category: "growth",
  },
  {
    id: "workout",
    title: "Strength training",
    description: "Build strength and discipline",
    icon: "💪",
    color: "#ef4444",
    frequency: { type: "specific_days", days: [1, 3, 5] },
    category: "body",
  },
  {
    id: "journal",
    title: "Daily journaling",
    description: "Reflect on your day",
    icon: "✍️",
    color: "#6366f1",
    frequency: { type: "daily" },
    category: "mind",
  },
  {
    id: "no-phone",
    title: "No phone before 8am",
    description: "Protect your morning focus",
    icon: "🌙",
    color: "#0ea5e9",
    frequency: { type: "daily" },
    category: "lifestyle",
  },
  {
    id: "healthy-meal",
    title: "Eat a healthy meal",
    description: "Nourish your body intentionally",
    icon: "🥗",
    color: "#10b981",
    frequency: { type: "daily" },
    category: "health",
  },
  {
    id: "sleep-early",
    title: "In bed by 10:30pm",
    description: "Protect your sleep schedule",
    icon: "😴",
    color: "#7c3aed",
    frequency: { type: "daily" },
    category: "health",
  },
  {
    id: "gratitude",
    title: "Write 3 things I'm grateful for",
    description: "Train your brain for positivity",
    icon: "❤️",
    color: "#ec4899",
    frequency: { type: "daily" },
    category: "mind",
  },
  {
    id: "walk",
    title: "Evening walk",
    description: "Wind down with movement",
    icon: "🌿",
    color: "#84cc16",
    frequency: { type: "specific_days", days: [1, 2, 3, 4, 5] },
    category: "body",
  },
  {
    id: "learn",
    title: "Learn something new",
    description: "Grow a little every day",
    icon: "🧠",
    color: "#f59e0b",
    frequency: { type: "times_per_week", count: 5 },
    category: "growth",
  },
];

export const TEMPLATE_CATEGORIES: Record<HabitTemplate["category"], { label: string; emoji: string }> = {
  health: { label: "Health", emoji: "❤️" },
  mind: { label: "Mind", emoji: "🧠" },
  body: { label: "Body", emoji: "💪" },
  growth: { label: "Growth", emoji: "📈" },
  lifestyle: { label: "Lifestyle", emoji: "✨" },
};
