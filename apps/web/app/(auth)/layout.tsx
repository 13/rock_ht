import { Logo } from "@/components/ui/logo";

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
            <p className="text-2xl font-bold tracking-tight text-foreground">sisiGo</p>
            <p className="text-sm text-muted-foreground mt-1">Build habits that stick</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
