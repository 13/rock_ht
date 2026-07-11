"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, RotateCcw, AlertCircle } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { useAiCoach } from "@/hooks/use-ai-coach";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import { weeklyConsistencyScore } from "@sisigo/utils";
import { cn } from "@/lib/utils";

const SUGGESTED_QUESTIONS = [
  "Why am I struggling with consistency?",
  "What habit should I add next?",
  "How can I make my habits stick?",
  "Which habit should I focus on most?",
  "What's my biggest strength right now?",
];

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

export default function CoachPage() {
  const { messages, isStreaming, error, sendMessage, clearMessages } = useAiCoach();
  const { habits } = useHabits();
  const { monthCompletions } = useCompletions();
  const { streaks } = useStreaks();

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeHabits = habits.filter((h) => !h.is_archived);
  const score = weeklyConsistencyScore(habits, monthCompletions);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  function handleSend() {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isFirstMessage = messages.length === 0;

  return (
    <>
      <Header title="AI Coach" subtitle="Powered by Claude" />

      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Context strip */}
        <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border bg-card/50 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>
            {activeHabits.length} active habit{activeHabits.length !== 1 ? "s" : ""}
          </span>
          <span className="text-border">·</span>
          <span>
            {score}/100 consistency
          </span>
          <span className="text-border">·</span>
          <span>{streaks.filter((s) => s.current_streak > 0).length} active streaks</span>

          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              New chat
            </button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {isFirstMessage && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center text-center pt-8 pb-4"
            >
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Your habit coach is ready
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Ask anything about your habits, streaks, or what to improve next.
                Your personal data is used to give specific advice.
              </p>

              {/* Suggested questions */}
              <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-lg">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={isStreaming}
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-card border border-border rounded-tl-sm text-foreground"
                  )}
                >
                  {msg.content || (
                    msg.role === "assistant" && isStreaming ? <TypingIndicator /> : null
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Streaming typing indicator (after last message is empty) */}
          {isStreaming &&
            messages.length > 0 &&
            messages[messages.length - 1]?.content === "" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm">
                  <TypingIndicator />
                </div>
              </motion.div>
            )}

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-xl px-4 py-3"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-card/80 backdrop-blur-sm px-6 py-4">
          <div className="flex items-end gap-3 max-w-2xl">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your coach anything…"
              rows={1}
              disabled={isStreaming}
              className={cn(
                "flex-1 resize-none rounded-xl border border-border bg-secondary/40 px-4 py-3",
                "text-sm text-foreground placeholder:text-muted-foreground/60",
                "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
                "transition-colors max-h-32 scrollbar-thin",
                "disabled:opacity-50"
              )}
              style={{ minHeight: "44px" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              size="sm"
              className="h-11 w-11 p-0 shrink-0 rounded-xl"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-2">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  );
}
