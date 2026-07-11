"use client";

import { useEffect } from "react";

export interface ShortcutMap {
  [key: string]: (e: KeyboardEvent) => void;
}

// Registers keyboard shortcuts. Ignores events when focus is inside an input/textarea.
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const key = [
        e.metaKey && "meta",
        e.ctrlKey && "ctrl",
        e.shiftKey && "shift",
        e.altKey && "alt",
        e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join("+");

      const handler = shortcuts[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
