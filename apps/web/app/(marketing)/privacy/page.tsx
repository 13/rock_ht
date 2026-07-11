import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — sisiGo' }

export default function PrivacyPage() {
  const updated = 'July 10, 2026'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-3xl mx-auto">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span>🌀</span> sisiGo
        </Link>
      </nav>
      <article className="max-w-3xl mx-auto px-4 py-12 prose prose-neutral dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: {updated}</p>

        <h2>What we collect</h2>
        <p>We collect the information you provide when you create an account (email address, display name) and the habit and journal data you enter into sisiGo. We also collect basic usage analytics to improve the product.</p>

        <h2>How we use it</h2>
        <p>Your data is used solely to operate sisiGo: to store your habits, display your progress, send reminders you configure, and provide AI-powered coaching. We do not sell your personal data to third parties.</p>

        <h2>Third-party services</h2>
        <p>We use the following third-party services:</p>
        <ul>
          <li><strong>Supabase</strong> — database and authentication (EU and US regions)</li>
          <li><strong>Stripe</strong> — payment processing. Stripe stores payment card data; we never see your card number.</li>
          <li><strong>Anthropic</strong> — AI responses in the coach feature. Your habit data is sent to Anthropic solely to generate your coaching response and is not stored by Anthropic for training.</li>
          <li><strong>Sentry</strong> — error monitoring. Crash reports may include device and session metadata.</li>
          <li><strong>PostHog</strong> — product analytics. Anonymized usage events only.</li>
        </ul>

        <h2>Data retention</h2>
        <p>Your account and all associated data are retained for as long as your account is active. You may delete your account at any time from the Settings page, which permanently deletes all your data within 30 days.</p>

        <h2>Your rights</h2>
        <p>You may request a copy of your data (Settings → Export) or request deletion by emailing us. If you are located in the EU, you have rights under GDPR including the right to access, correct, and erase your data.</p>

        <h2>Cookies</h2>
        <p>We use cookies solely for authentication session management. We do not use advertising cookies.</p>

        <h2>Contact</h2>
        <p>For privacy questions, email <a href="mailto:privacy@sisigo.app">privacy@sisigo.app</a>.</p>
      </article>
    </div>
  )
}
