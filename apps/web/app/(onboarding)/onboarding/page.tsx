"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHabits } from "@/hooks/use-habits";
import { useProfile } from "@/hooks/use-profile";
import { HABIT_TEMPLATES, TEMPLATE_CATEGORIES } from "@sisigo/utils";
import type { HabitTemplate } from "@sisigo/utils";

const STEPS = ["welcome", "templates", "done"] as const;
type Step = (typeof STEPS)[number];

const SLIDE = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div {...SLIDE} className="text-center max-w-md">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="text-8xl mb-8"
      >
        ✨
      </motion.div>
      <h1 className="text-4xl font-bold text-foreground mb-4 tracking-tight">
        Welcome to sisiGo
      </h1>
      <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
        The simplest way to build habits that stick. One tap, every day.
      </p>
      <div className="grid grid-cols-3 gap-4 mb-10 text-center">
        {[
          { emoji: "🎯", label: "Track habits" },
          { emoji: "🔥", label: "Build streaks" },
          { emoji: "📊", label: "See growth" },
        ].map(({ emoji, label }) => (
          <div
            key={label}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="text-3xl mb-2">{emoji}</div>
            <div className="text-xs font-medium text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
      </div>
      <Button size="lg" onClick={onNext} className="w-full gap-2 text-base">
        Get started
        <ArrowRight className="h-4 w-4" />
      </Button>
    </motion.div>
  );
}

// ─── Step 2: Template picker ──────────────────────────────────────────────────

function TemplatesStep({
  onNext,
}: {
  onNext: (selected: HabitTemplate[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<
    HabitTemplate["category"] | "all"
  >("all");

  const visible =
    activeCategory === "all"
      ? HABIT_TEMPLATES
      : HABIT_TEMPLATES.filter((t) => t.category === activeCategory);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  }

  const selectedTemplates = HABIT_TEMPLATES.filter((t) => selected.has(t.id));

  return (
    <motion.div {...SLIDE} className="w-full max-w-xl">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Pick your first habits
        </h2>
        <p className="text-muted-foreground text-sm">
          Choose up to 5 to start with. You can always add more later.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
            activeCategory === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
        {(Object.entries(TEMPLATE_CATEGORIES) as [HabitTemplate["category"], { label: string; emoji: string }][]).map(
          ([key, { label, emoji }]) => (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                activeCategory === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {emoji} {label}
            </button>
          )
        )}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-2 mb-6 max-h-80 overflow-y-auto pr-1">
        {visible.map((template) => {
          const isSelected = selected.has(template.id);
          return (
            <button
              key={template.id}
              onClick={() => toggle(template.id)}
              className={cn(
                "relative text-left rounded-2xl border p-3.5 transition-all",
                isSelected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card hover:border-border/80 hover:bg-accent/50"
              )}
            >
              {isSelected && (
                <div className="absolute top-2.5 right-2.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl">{template.icon}</span>
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: template.color }}
                />
              </div>
              <p className="text-sm font-medium text-foreground leading-tight">
                {template.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                {template.description}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {selected.size === 0
            ? "None selected"
            : `${selected.size} selected`}
        </p>
        <Button
          onClick={() => onNext(selectedTemplates)}
          disabled={selected.size === 0}
          className="gap-2"
        >
          {selected.size === 0 ? "Skip" : `Add ${selected.size} habit${selected.size > 1 ? "s" : ""}`}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {selected.size === 0 && (
        <button
          onClick={() => onNext([])}
          className="w-full text-center text-xs text-muted-foreground mt-3 hover:text-foreground transition-colors"
        >
          Skip and start from scratch
        </button>
      )}
    </motion.div>
  );
}

// ─── Step 3: Done ─────────────────────────────────────────────────────────────

function DoneStep({ habitCount, onFinish }: { habitCount: number; onFinish: () => void }) {
  return (
    <motion.div {...SLIDE} className="text-center max-w-sm">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className="text-8xl mb-6"
      >
        🎉
      </motion.div>
      <h2 className="text-3xl font-bold text-foreground mb-3">
        You’re all set!
      </h2>
      <p className="text-muted-foreground mb-2">
        {habitCount > 0
          ? `${habitCount} habit${habitCount > 1 ? "s" : ""} added and ready to track.`
          : "Your dashboard is ready."}
      </p>
      <p className="text-sm text-muted-foreground mb-8">
        Consistency is built one day at a time. Let’s start today.
      </p>
      <Button size="lg" onClick={onFinish} className="w-full text-base">
        Open my dashboard
      </Button>
    </motion.div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { createHabit } = useHabits();
  const { updateProfile } = useProfile();
  const [step, setStep] = useState<Step>("welcome");
  const [habitCount, setHabitCount] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  async function handleTemplatesSubmit(templates: HabitTemplate[]) {
    if (templates.length === 0) {
      setStep("done");
      return;
    }

    setIsCreating(true);
    try {
      await Promise.all(
        templates.map((t) =>
          createHabit({
            title: t.title,
            description: t.description,
            icon: t.icon,
            color: t.color,
            frequency: t.frequency,
          })
        )
      );
      setHabitCount(templates.length);
    } finally {
      setIsCreating(false);
    }
    setStep("done");
  }

  async function handleFinish() {
    await updateProfile({ onboarding_completed: true });
    router.push("/dashboard");
  }

  return (
    <div className="w-full max-w-xl px-6 py-12">
      {/* Progress dots */}
      <div className="flex justify-center gap-2 mb-10">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              step === s
                ? "w-8 bg-primary"
                : STEPS.indexOf(step) > i
                  ? "w-3 bg-primary/40"
                  : "w-3 bg-border"
            )}
          />
        ))}
      </div>

      <div className="flex justify-center">
        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <WelcomeStep key="welcome" onNext={() => setStep("templates")} />
          )}
          {step === "templates" && (
            <TemplatesStep key="templates" onNext={handleTemplatesSubmit} />
          )}
          {step === "done" && (
            <DoneStep
              key="done"
              habitCount={habitCount}
              onFinish={handleFinish}
            />
          )}
        </AnimatePresence>
      </div>

      {isCreating && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <p className="text-foreground font-medium animate-pulse">
            Creating your habits…
          </p>
        </div>
      )}
    </div>
  );
}
