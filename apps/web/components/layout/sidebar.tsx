"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ListChecks,
  BarChart3,
  BookOpen,
  Trophy,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

const NAV_ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Today" },
  { href: "/habits", icon: ListChecks, label: "Habits" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/journal", icon: BookOpen, label: "Journal" },
  { href: "/achievements", icon: Trophy, label: "Achievements" },
  { href: "/coach", icon: Sparkles, label: "AI Coach" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { signOut, user } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b border-border">
        <Logo size={28} textClassName="text-lg" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    "transition-colors duration-150",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-xl bg-primary/10"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <item.icon className="relative h-4 w-4 shrink-0" />
                  <span className="relative">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl p-2.5 mb-1">
          <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">
              {user?.email?.[0]?.toUpperCase() ?? "U"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {user?.email ?? ""}
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className={cn(
            "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "transition-colors duration-150"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
