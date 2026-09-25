"use client";

import { useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Download, Upload, Bell, BellOff, AlertCircle, CreditCard, Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useWebNotifications } from "@/hooks/use-web-notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getAllHabits, getCompletions, createHabit, addCompletion } from "@rock_ht/db";
import { createClient } from "@/lib/supabase/client";
import type { TypedSupabaseClient } from "@rock_ht/db";
import type { TimeFormat, DateFormat } from "@rock_ht/types";
import { today } from "@rock_ht/utils";

const TIME_FORMATS: { value: TimeFormat; label: string; example: string }[] = [
  { value: "12h", label: "12-hour", example: "9:30 AM" },
  { value: "24h", label: "24-hour", example: "09:30" },
];

const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", example: "05/17/2026" },
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY", example: "17.05.2026" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD", example: "2026-05-17" },
  { value: "D MMM YYYY", label: "D MMM YYYY", example: "17 May 2026" },
];

const THEMES = [
  { value: "light", label: "Light", bg: "bg-white border border-zinc-200", fg: "#18181b" },
  { value: "dark", label: "Dark", bg: "bg-zinc-950", fg: "#fafafa" },
  { value: "midnight", label: "Midnight", bg: "bg-black", fg: "#e2e8f0" },
  { value: "forest", label: "Forest", bg: "bg-emerald-950", fg: "#d1fae5" },
  { value: "sunset", label: "Sunset", bg: "bg-orange-950", fg: "#fde68a" },
];

function asDbClient(c: unknown): TypedSupabaseClient {
  return c as TypedSupabaseClient;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { profile, updateProfile, isUpdating } = useProfile();
  const { permission, supported, requestPermission } = useWebNotifications();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ habits: number; completions: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [requestingNotif, setRequestingNotif] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isPro, plan, currentPeriodEnd } = useSubscription();

  async function handleUpgrade() {
    const res = await fetch('/api/billing/checkout', { method: 'POST' })
    const { url } = await res.json()
    window.location.href = url
  }

  async function handleManageBilling() {
    const res = await fetch('/api/billing/portal', { method: 'POST' })
    const { url } = await res.json()
    window.location.href = url
  }

  async function handleRequestNotifications() {
    setRequestingNotif(true);
    await requestPermission();
    setRequestingNotif(false);
  }

  async function handleExport() {
    if (!user) return;
    setExporting(true);
    try {
      const db = asDbClient(createClient());
      const [allHabits, allCompletions] = await Promise.all([
        getAllHabits(db, user.id),
        getCompletions(db, user.id),
      ]);

      const completionsByHabit = new Map<string, typeof allCompletions>();
      for (const c of allCompletions) {
        const list = completionsByHabit.get(c.habit_id) ?? [];
        list.push(c);
        completionsByHabit.set(c.habit_id, list);
      }

      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        habits: allHabits.map((h) => ({
          title: h.title,
          description: h.description,
          icon: h.icon,
          color: h.color,
          frequency: h.frequency,
          target_value: h.target_value,
          target_unit: h.target_unit,
          reminder_time: h.reminder_time,
          reminder_enabled: h.reminder_enabled,
          is_archived: h.is_archived,
          created_at: h.created_at,
          completions: (completionsByHabit.get(h.id) ?? []).map((c) => ({
            completed_date: c.completed_date,
            value: c.value,
            note: c.note,
          })),
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rock_ht-export-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setImportError(null);
    setImportResult(null);
    setImporting(true);

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      if (payload.version !== 1 || !Array.isArray(payload.habits)) {
        throw new Error("Invalid rock export file.");
      }

      const db = asDbClient(createClient());
      let totalCompletions = 0;

      for (const h of payload.habits) {
        if (!h.title || !h.frequency) continue;

        const newHabit = await createHabit(db, user.id, {
          title: h.title,
          description: h.description ?? undefined,
          icon: h.icon ?? "✨",
          color: h.color ?? "#6366f1",
          frequency: h.frequency,
          target_value: h.target_value ?? 1,
          target_unit: h.target_unit ?? undefined,
          reminder_time: h.reminder_time ?? undefined,
          reminder_enabled: h.reminder_enabled ?? false,
        });

        if (Array.isArray(h.completions)) {
          await Promise.all(
            h.completions.map((c: { completed_date: string; value?: number; note?: string }) =>
              addCompletion(db, user.id, {
                habit_id: newHabit.id,
                date: c.completed_date,
                value: c.value ?? 1,
                note: c.note ?? undefined,
              })
            )
          );
          totalCompletions += h.completions.length;
        }
      }

      setImportResult({ habits: payload.habits.length, completions: totalCompletions });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <Header title="Settings" />

      <div className="p-6 max-w-lg mx-auto space-y-6">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
              <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">
                  {user?.email?.[0]?.toUpperCase() ?? "U"}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground">
                  Member since {new Date(user?.created_at ?? "").toLocaleDateString()}
                </p>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>

        {/* Plan & Billing */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Plan & Billing</CardTitle>
            </div>
            <CardDescription>Manage your subscription</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize">{plan}</span>
                {isPro && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    <Sparkles className="h-3 w-3" /> Pro
                  </span>
                )}
              </div>
              {isPro && currentPeriodEnd && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Renews {new Date(currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
              {!isPro && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  5 habits · No AI features
                </p>
              )}
            </div>
            {isPro ? (
              <Button variant="outline" size="sm" onClick={handleManageBilling}>
                Manage billing
              </Button>
            ) : (
              <Button size="sm" onClick={handleUpgrade}>
                Upgrade to Pro
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Data Export / Import */}
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
            <CardDescription>Export all your habits and history, or import a previous backup</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="gap-2 flex-1"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Exporting…" : "Export JSON"}
              </Button>

              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="gap-2 flex-1"
              >
                <Upload className="h-4 w-4" />
                {importing ? "Importing…" : "Import JSON"}
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImport}
              />
            </div>

            {importResult && (
              <div className="flex items-start gap-2.5 rounded-xl bg-green-500/10 border border-green-500/20 p-3">
                <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  Imported <span className="font-semibold">{importResult.habits}</span> habits
                  and <span className="font-semibold">{importResult.completions}</span> completions.
                </p>
              </div>
            )}

            {importError && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 p-3">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">{importError}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notifications */}
        {supported && (
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Receive browser alerts when a habit reminder is due
              </CardDescription>
            </CardHeader>
            <CardContent>
              {permission === "granted" ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <Bell className="h-4 w-4 text-green-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Notifications enabled
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      You’ll receive reminders for habits with a set reminder time.
                    </p>
                  </div>
                </div>
              ) : permission === "denied" ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                  <BellOff className="h-4 w-4 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Notifications blocked
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Allow notifications in your browser settings to enable reminders.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enable browser notifications to get reminded when it’s time for a habit.
                  </p>
                  <Button
                    onClick={handleRequestNotifications}
                    disabled={requestingNotif}
                    className="gap-2"
                  >
                    <Bell className="h-4 w-4" />
                    {requestingNotif ? "Requesting…" : "Enable notifications"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Localization */}
        <Card>
          <CardHeader>
            <CardTitle>Localization</CardTitle>
            <CardDescription>Time and date display preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Time format */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Time format</p>
              <div className="flex gap-2">
                {TIME_FORMATS.map((tf) => {
                  const active = (profile?.time_format ?? "12h") === tf.value;
                  return (
                    <button
                      key={tf.value}
                      disabled={isUpdating}
                      onClick={() => updateProfile({ time_format: tf.value })}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-0.5 py-2.5 px-3 rounded-xl border transition-all",
                        "text-sm disabled:opacity-50",
                        active
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <span className="font-semibold">{tf.label}</span>
                      <span className="text-xs opacity-70">{tf.example}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date format */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Date format</p>
              <div className="grid grid-cols-2 gap-2">
                {DATE_FORMATS.map((df) => {
                  const active = (profile?.date_format ?? "MM/DD/YYYY") === df.value;
                  return (
                    <button
                      key={df.value}
                      disabled={isUpdating}
                      onClick={() => updateProfile({ date_format: df.value })}
                      className={cn(
                        "flex flex-col items-start gap-0.5 py-2.5 px-3 rounded-xl border transition-all",
                        "text-sm disabled:opacity-50",
                        active
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <span className="font-semibold">{df.label}</span>
                      <span className="text-xs opacity-70">{df.example}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Theme */}
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose your visual style</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    "relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all",
                    "hover:bg-accent",
                    theme === t.value ? "ring-2 ring-primary" : ""
                  )}
                >
                  <div
                    className={cn(
                      "h-10 w-full rounded-lg flex items-center justify-center",
                      t.bg
                    )}
                  >
                    {theme === t.value && (
                      <Check className="h-4 w-4" style={{ color: t.fg }} />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{t.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
