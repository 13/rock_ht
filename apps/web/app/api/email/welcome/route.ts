import { NextResponse } from 'next/server'
import { getResend } from '@/lib/email'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)
}

export async function POST(req: Request) {
  let name: string | undefined

  try {
    const body = await req.json()
    name = typeof body?.name === 'string' ? body.name : undefined
  } catch {
    return NextResponse.json({ ok: false })
  }

  // Auth required, and the email is always the signed-in user's own — any `email` in the body is
  // ignored. Without this, anyone could POST an arbitrary address here and use this route to spam it.
  let email: string | undefined
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    email = data.user?.email ?? undefined
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!email) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const safeName = escapeHtml(name || email.split('@')[0] || email)

  try {
    const { error } = await getResend().emails.send({
      from: process.env.FROM_EMAIL!,
      to: email,
      subject: 'Welcome to rock 🌀',
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h1 style="font-size: 24px; margin-bottom: 8px;">Welcome, ${safeName}! 🎉</h1>
          <p style="color: #666; line-height: 1.6; margin-bottom: 16px;">
            Your rock account is ready. Start building habits that stick.
          </p>
          <p style="margin-bottom: 16px;">Here's how to get started:</p>
          <ol style="color: #333; line-height: 2;">
            <li>Create your first habit</li>
            <li>Complete it once today to start your streak</li>
            <li>Come back tomorrow to keep it going</li>
          </ol>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
             style="display: inline-block; margin-top: 24px; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 600;">
            Open rock →
          </a>
          <p style="margin-top: 32px; font-size: 12px; color: #999;">
            You're receiving this because you signed up at rock-ht.app.
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" style="color: #999;">Manage notifications</a>
          </p>
        </div>
      `,
    })

    if (error) {
      console.error('[email/welcome] Resend error:', error.message)
      // Return 200 — email failure is non-critical, don't surface to the user
      return NextResponse.json({ ok: false, error: error.message })
    }
  } catch (err) {
    console.error('[email/welcome] Unexpected error:', err)
    // Return 200 — email failure is non-critical
    return NextResponse.json({ ok: false })
  }

  return NextResponse.json({ ok: true })
}
