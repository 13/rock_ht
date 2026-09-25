import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { TimezoneSync } from "@/components/layout/timezone-sync";
import { KeyboardShortcutsHelp } from "@/components/ui/keyboard-shortcuts-help";
import type { ProfileRow } from "@rock_ht/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Ensure a profile row exists — the DB trigger only fires for new signups,
  // so users who existed before migrations were applied need this upsert.
  let { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profileData) {
    const { data: created } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email!,
        display_name:
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email!.split("@")[0],
      })
      .select()
      .single();
    profileData = created;
  }

  const profile = profileData as ProfileRow | null;

  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen">
      <TimezoneSync userId={user.id} profileTimezone={profile?.timezone} />

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile bottom nav */}
      <div className="block md:hidden">
        <MobileNav />
      </div>

      {/* Main content — offset by sidebar on desktop, pad bottom on mobile */}
      <main className="md:pl-60 pb-20 md:pb-0 min-h-screen">
        {children}
      </main>

      {/* Global keyboard shortcuts panel — ? key */}
      <KeyboardShortcutsHelp />
    </div>
  );
}
