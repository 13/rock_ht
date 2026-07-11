"use client";

import { useTheme } from "next-themes";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", preview: "bg-white border border-zinc-200" },
  { value: "dark", label: "Dark", preview: "bg-zinc-950" },
  { value: "midnight", label: "Midnight", preview: "bg-black" },
  { value: "forest", label: "Forest", preview: "bg-emerald-950" },
  { value: "sunset", label: "Sunset", preview: "bg-orange-950" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-lg",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "transition-colors duration-150"
          )}
          aria-label="Change theme"
        >
          <Palette className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 min-w-[160px] rounded-xl border border-border bg-card p-1.5",
            "shadow-lg shadow-black/10",
            "animate-scale-in"
          )}
        >
          {THEMES.map((t) => (
            <DropdownMenu.Item
              key={t.value}
              onSelect={() => setTheme(t.value)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm cursor-pointer",
                "text-foreground hover:bg-accent outline-none transition-colors"
              )}
            >
              <div className={cn("h-4 w-4 rounded-full shrink-0", t.preview)} />
              <span className="flex-1">{t.label}</span>
              {theme === t.value && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
