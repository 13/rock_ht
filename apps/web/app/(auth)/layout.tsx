import { Logo } from "@/components/ui/logo";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <Logo size={56} showText={false} />
          <div className="text-center">
            <p className="text-2xl font-bold tracking-tight text-foreground">rock</p>
            <p className="text-sm text-muted-foreground mt-1">Build habits that stick</p>
          </div>
        </div>
        {isSupabaseConfigured() ? children : <NoWebLogin />}
      </div>
    </div>
  );
}

/** Shown instead of the login/signup forms by a build without Supabase (the self-hosted image). */
function NoWebLogin() {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground mb-2">
        This server has no web login configured
      </h1>
      <p className="text-sm text-muted-foreground">
        It is a self-hosted sync server. Connect the rock mobile app to it in Settings → Sync →
        Self-hosted.
      </p>
    </div>
  );
}
