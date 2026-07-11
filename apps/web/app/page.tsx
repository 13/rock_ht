import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">🌀</span>
          <span>sisiGo</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-full font-medium hover:opacity-90 transition-opacity"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-4 pt-20 pb-16 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full mb-6 font-medium">
          ✨ AI-powered habit coaching
        </div>
        <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-4">
          Build habits that
          <br />
          <span className="text-primary">actually stick</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mb-8">
          sisiGo helps you track habits with beautiful streaks, smart reminders, and an AI coach
          that understands your patterns — across all your devices.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/signup"
            className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity"
          >
            Start for free
          </Link>
          <Link
            href="/login"
            className="border border-border text-foreground px-8 py-3 rounded-xl font-semibold text-base hover:bg-accent transition-colors"
          >
            Log in
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-4">No credit card required · Free tier forever</p>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            emoji: '🔥',
            title: 'Streak Tracking',
            desc: 'Visual streak rings and calendar heatmaps make your progress impossible to ignore.',
          },
          {
            emoji: '🤖',
            title: 'AI Coach',
            desc: 'Get personalized insights from an AI that knows your habits, strengths, and patterns.',
          },
          {
            emoji: '⚡',
            title: 'One-Tap Completion',
            desc: 'Log any habit in under a second. Works offline. Syncs the moment you reconnect.',
          },
          {
            emoji: '📊',
            title: 'Deep Analytics',
            desc: "Weekly trends, time-of-day charts, and consistency scores reveal what's working.",
          },
          {
            emoji: '🌙',
            title: 'Beautiful Themes',
            desc: 'Light, dark, midnight, forest, and sunset themes. Your app, your aesthetic.',
          },
          {
            emoji: '📱',
            title: 'Mobile + Web',
            desc: 'Native iOS and Android apps sync in real time with the full-featured web dashboard.',
          },
        ].map(f => (
          <div key={f.title} className="bg-card border border-border rounded-2xl p-5">
            <div className="text-3xl mb-3">{f.emoji}</div>
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-10">Simple pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="text-sm font-medium text-muted-foreground mb-1">Free</div>
            <div className="text-4xl font-bold mb-4">$0</div>
            <ul className="text-sm text-muted-foreground space-y-2 mb-6">
              {['Up to 5 habits', 'Streak tracking', 'Basic analytics', 'Mobile + Web', 'Offline support'].map(i => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> {i}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="block text-center border border-border rounded-xl py-2 font-medium hover:bg-accent transition-colors text-sm">
              Get started
            </Link>
          </div>
          <div className="bg-primary text-primary-foreground rounded-2xl p-6">
            <div className="text-sm font-medium opacity-70 mb-1">Pro</div>
            <div className="text-4xl font-bold mb-4">$5<span className="text-base font-normal opacity-70">/mo</span></div>
            <ul className="text-sm opacity-80 space-y-2 mb-6">
              {['Unlimited habits', 'AI Coach', 'AI Insights', 'Data export', 'Advanced analytics', 'Priority support'].map(i => (
                <li key={i} className="flex items-center gap-2">
                  <span>✓</span> {i}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="block text-center bg-primary-foreground text-primary rounded-xl py-2 font-medium hover:opacity-90 transition-opacity text-sm">
              Start free, upgrade anytime
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>🌀</span>
            <span>sisiGo © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
