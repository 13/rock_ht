"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useHabits } from "@/hooks/use-habits";
import { PRESET_ICONS, PRESET_COLORS } from "@sisigo/types";
import type {
  CreateHabitInput,
  HabitWithFrequency,
  Frequency,
} from "@sisigo/types";

const schema = z.object({
  title: z.string().min(1, "Habit name is required").max(60, "Too long"),
  description: z.string().max(200).optional(),
  icon: z.string(),
  color: z.string(),
  frequency_type: z.enum(["daily", "specific_days", "times_per_week"]),
  specific_days: z.array(z.number()).optional(),
  times_per_week: z.number().min(1).max(7).optional(),
  reminder_enabled: z.boolean(),
  reminder_time: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

interface HabitFormProps {
  initial?: HabitWithFrequency;
  onSubmit: (input: CreateHabitInput) => Promise<void>;
  onCancel: () => void;
}

export function HabitForm({ initial, onSubmit, onCancel }: HabitFormProps) {
  const { isAtHabitLimit } = useHabits();
  // Only enforce limit when creating a new habit, not when editing an existing one
  const atLimit = !initial && isAtHabitLimit;

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      icon: initial?.icon ?? "✨",
      color: initial?.color ?? "#6366f1",
      frequency_type: initial?.frequency.type ?? "daily",
      specific_days:
        initial?.frequency.type === "specific_days"
          ? initial.frequency.days
          : [1, 2, 3, 4, 5],
      times_per_week:
        initial?.frequency.type === "times_per_week"
          ? initial.frequency.count
          : 3,
      reminder_enabled: initial?.reminder_enabled ?? false,
      reminder_time: initial?.reminder_time ?? "09:00",
    },
  });

  const selectedColor = watch("color");
  const selectedIcon = watch("icon");
  const freqType = watch("frequency_type");
  const reminderEnabled = watch("reminder_enabled");

  const [suggestions, setSuggestions] = useState<
    { icon: string; title: string; reason: string }[]
  >([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  async function fetchSuggestions() {
    setLoadingSuggestions(true);
    try {
      const res = await fetch("/api/ai/suggest-habits", { method: "POST" });
      if (res.ok) {
        const { suggestions: s } = await res.json();
        if (Array.isArray(s)) setSuggestions(s);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function handleFormSubmit(data: FormData) {
    let frequency: Frequency;

    if (data.frequency_type === "daily") {
      frequency = { type: "daily" };
    } else if (data.frequency_type === "specific_days") {
      frequency = { type: "specific_days", days: data.specific_days ?? [1, 2, 3, 4, 5] };
    } else {
      frequency = { type: "times_per_week", count: data.times_per_week ?? 3 };
    }

    await onSubmit({
      title: data.title,
      description: data.description || undefined,
      icon: data.icon,
      color: data.color,
      frequency,
      reminder_enabled: data.reminder_enabled,
      reminder_time: data.reminder_enabled ? data.reminder_time : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      {/* Preview */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ backgroundColor: selectedColor + "30", color: selectedColor }}
        >
          {selectedIcon}
        </div>
        <div>
          <p className="font-medium text-sm text-foreground">
            {watch("title") || "Habit name"}
          </p>
          <p className="text-xs text-muted-foreground">Preview</p>
        </div>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Habit name</label>
        <input
          {...register("title")}
          placeholder="e.g. Morning Run"
          className={cn(
            "w-full h-10 px-3 rounded-lg border bg-background text-sm",
            "text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
            errors.title ? "border-destructive" : "border-input"
          )}
        />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Icon picker */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Icon</label>
        <Controller
          control={control}
          name="icon"
          render={({ field }) => (
            <div className="grid grid-cols-10 gap-1">
              {PRESET_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => field.onChange(emoji)}
                  className={cn(
                    "h-8 w-8 rounded-lg text-base flex items-center justify-center",
                    "transition-colors hover:bg-accent",
                    field.value === emoji ? "bg-primary/20 ring-2 ring-primary" : "bg-secondary"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* Color picker */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Color</label>
        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => field.onChange(hex)}
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform hover:scale-110",
                    field.value === hex ? "ring-2 ring-offset-2 ring-offset-background scale-110" : ""
                  )}
                  style={{
                    backgroundColor: hex,
                    outlineColor: hex,
                  }}
                />
              ))}
            </div>
          )}
        />
      </div>

      {/* Frequency */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Frequency</label>
        <div className="flex gap-2">
          {(["daily", "specific_days", "times_per_week"] as const).map((type) => (
            <Controller
              key={type}
              control={control}
              name="frequency_type"
              render={({ field }) => (
                <button
                  type="button"
                  onClick={() => field.onChange(type)}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-medium transition-colors",
                    field.value === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {type === "daily" ? "Daily" : type === "specific_days" ? "Select days" : "X per week"}
                </button>
              )}
            />
          ))}
        </div>

        {freqType === "specific_days" && (
          <Controller
            control={control}
            name="specific_days"
            render={({ field }) => (
              <div className="flex gap-1.5">
                {DAY_LABELS.map((label, idx) => {
                  const selected = field.value?.includes(idx) ?? false;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        const current = field.value ?? [];
                        field.onChange(
                          selected
                            ? current.filter((d) => d !== idx)
                            : [...current, idx]
                        );
                      }}
                      className={cn(
                        "flex-1 h-8 rounded-lg text-xs font-semibold transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          />
        )}

        {freqType === "times_per_week" && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground">Times per week:</label>
            <Controller
              control={control}
              name="times_per_week"
              render={({ field }) => (
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => field.onChange(n)}
                      className={cn(
                        "h-7 w-7 rounded-lg text-xs font-semibold transition-colors",
                        field.value === n
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>
        )}
      </div>

      {/* Reminder */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">Daily reminder</label>
          <Controller
            control={control}
            name="reminder_enabled"
            render={({ field }) => (
              <button
                type="button"
                onClick={() => field.onChange(!field.value)}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors duration-200",
                  field.value ? "bg-primary" : "bg-secondary"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                    field.value ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            )}
          />
        </div>
        {reminderEnabled && (
          <input
            {...register("reminder_time")}
            type="time"
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}
      </div>

      {/* AI habit suggestions (new habits only) */}
      {!initial && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Need inspiration?
            </span>
            <button
              type="button"
              onClick={fetchSuggestions}
              disabled={loadingSuggestions}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {loadingSuggestions ? "Thinking…" : "Suggest habits"}
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => {
                    setValue("title", s.title);
                    setValue("icon", s.icon);
                  }}
                  className="w-full text-left flex items-start gap-2.5 rounded-xl border border-border bg-secondary/30 hover:bg-accent/60 p-3 transition-colors group"
                >
                  <span className="text-xl shrink-0">{s.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {s.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {s.reason}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        {atLimit ? (
          <div className="flex-1 text-sm text-amber-500 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Free plan is limited to 5 habits.{" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() =>
                fetch("/api/billing/checkout", { method: "POST" })
                  .then((r) => r.json())
                  .then((d) => {
                    window.location.href = d.url;
                  })
              }
            >
              Upgrade to Pro
            </button>
          </div>
        ) : (
          <Button
            type="submit"
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? "Save changes" : "Create habit"}
          </Button>
        )}
      </div>
    </form>
  );
}
