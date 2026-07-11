"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const SHORTCUTS = [
  { section: "Navigation" },
  { key: "G then D", description: "Go to Today" },
  { key: "G then H", description: "Go to Habits" },
  { key: "G then A", description: "Go to Analytics" },
  { key: "G then J", description: "Go to Journal" },
  { section: "Habits" },
  { key: "N", description: "Create new habit" },
  { key: "Space", description: "Complete first pending habit" },
  { section: "Other" },
  { key: "?", description: "Show this help" },
];

function Kbd({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {children.split("+").map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground/60 mx-0.5 text-[10px]">+</span>}
          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-secondary px-1.5 font-mono text-[10px] font-medium text-foreground">
            {part.trim()}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl",
            "animate-scale-in"
          )}
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {SHORTCUTS.map((item, i) => {
              if ("section" in item) {
                return (
                  <p
                    key={i}
                    className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 first:pt-0"
                  >
                    {item.section}
                  </p>
                );
              }
              return (
                <div key={i} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">{item.description}</span>
                  <Kbd>{item.key}</Kbd>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground/60 mt-5 text-center">
            Press <kbd className="font-mono">?</kbd> to toggle this panel
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
