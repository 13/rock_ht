import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) redirect("/");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {children}
    </div>
  );
}
