import Link from 'next/link'

export const metadata = { title: 'Terms of Service — sisiGo' }

export default function TermsPage() {
  const updated = 'July 10, 2026'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-3xl mx-auto">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span>🌀</span> sisiGo
        </Link>
      </nav>
      <article className="max-w-3xl mx-auto px-4 py-12 prose prose-neutral dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground">Last updated: {updated}</p>

        <h2>Acceptance</h2>
        <p>By using sisiGo you agree to these terms. If you do not agree, do not use the service.</p>

        <h2>Description of service</h2>
        <p>sisiGo is a habit tracking application. We provide the service on an "as is" basis and may modify, suspend, or discontinue features at any time.</p>

        <h2>Your account</h2>
        <p>You are responsible for maintaining the security of your account. Notify us immediately if you suspect unauthorized access. You must be at least 13 years old to use sisiGo.</p>

        <h2>Acceptable use</h2>
        <p>You may not use sisiGo to violate any laws, infringe intellectual property rights, distribute malware, or attempt to gain unauthorized access to our systems or other users' accounts.</p>

        <h2>Subscriptions and billing</h2>
        <p>The Free plan is free indefinitely. The Pro plan is billed monthly. You may cancel at any time from Settings; your Pro access continues until the end of the current billing period. We do not offer refunds for partial months.</p>

        <h2>Data and content</h2>
        <p>You own the data you enter into sisiGo. By using the service you grant us a limited license to store, process, and display your data in order to provide the service. We do not claim ownership of your content.</p>

        <h2>Termination</h2>
        <p>We may suspend or terminate your account if you violate these terms. You may delete your account at any time from Settings.</p>

        <h2>Limitation of liability</h2>
        <p>To the maximum extent permitted by law, sisiGo is not liable for indirect, incidental, or consequential damages. Our total liability to you for any claim is limited to the amount you paid us in the 12 months prior to the claim.</p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the jurisdiction in which sisiGo operates, without regard to conflict-of-law provisions.</p>

        <h2>Contact</h2>
        <p>Questions about these terms? Email <a href="mailto:legal@sisigo.app">legal@sisigo.app</a>.</p>
      </article>
    </div>
  )
}
