"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Share2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HabitWithFrequency, StreakRow } from "@rock_ht/types";

interface ShareStreakModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitWithFrequency;
  streak: StreakRow | null;
}

function streakLabel(n: number): string {
  if (n >= 365) return "🏆 1-year streak";
  if (n >= 100) return "💎 100+ day streak";
  if (n >= 30) return "🔥 30+ day streak";
  if (n >= 7) return "⚡ 7+ day streak";
  return `🔥 ${n}-day streak`;
}

function shareText(habit: HabitWithFrequency, streak: number): string {
  return `${habit.icon} ${habit.title} — ${streak} day streak on rock! Building habits one day at a time. ✨`;
}

export function ShareStreakModal({
  open,
  onOpenChange,
  habit,
  streak,
}: ShareStreakModalProps) {
  const [copied, setCopied] = useState(false);
  const currentStreak = streak?.current_streak ?? 0;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  async function handleCopy() {
    await navigator.clipboard.writeText(shareText(habit, currentStreak));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!canShare) return;
    try {
      await navigator.share({
        title: `rock — ${habit.title}`,
        text: shareText(habit, currentStreak),
      });
    } catch {
      // user cancelled or share not supported — fall back silently
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/30",
            "focus:outline-none"
          )}
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="font-semibold text-foreground">
              Share streak
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Card preview */}
          <div
            className="rounded-2xl p-6 mb-5 relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${habit.color}22, ${habit.color}08)`, border: `1.5px solid ${habit.color}30` }}
          >
            {/* Background glow */}
            <div
              className="absolute -top-6 -right-6 h-24 w-24 rounded-full opacity-20 blur-2xl"
              style={{ backgroundColor: habit.color }}
            />

            <div className="relative">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                  style={{ backgroundColor: `${habit.color}25` }}
                >
                  {habit.icon}
                </div>
                <div>
                  <p className="font-semibold text-foreground text-base leading-tight">
                    {habit.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">rock</p>
                </div>
              </div>

              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl font-black tabular-nums"
                  style={{ color: habit.color }}
                >
                  {currentStreak}
                </span>
                <span className="text-sm text-muted-foreground font-medium">
                  day streak
                </span>
              </div>

              <p className="text-xs text-muted-foreground mt-1.5">
                {streakLabel(currentStreak)}
              </p>
            </div>
          </div>

          {/* Text preview */}
          <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 mb-5 select-all leading-relaxed">
            {shareText(habit, currentStreak)}
          </p>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={handleCopy}
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.span
                    key="check"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    className="flex items-center gap-1.5 text-green-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Copied!
                  </motion.span>
                ) : (
                  <motion.span
                    key="copy"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    className="flex items-center gap-1.5"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy text
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
            {canShare && (
              <Button className="flex-1 gap-2" onClick={handleShare}>
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
