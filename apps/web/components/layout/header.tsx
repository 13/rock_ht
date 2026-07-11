import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { formatDisplayDate } from "@sisigo/utils";
import { today } from "@sisigo/utils";

interface HeaderProps {
  title: string;
  subtitle?: string;
  left?: ReactNode;
}

export function Header({ title, subtitle, left }: HeaderProps) {
  const todayStr = today();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background/80 backdrop-blur-md px-6">
      <div className="flex-1 flex items-center gap-2">
        {left}
        <div>
          {title && <h1 className="font-semibold text-foreground">{title}</h1>}
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden sm:block text-xs text-muted-foreground mr-2">
          {formatDisplayDate(todayStr)}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
