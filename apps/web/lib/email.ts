import { Resend } from 'resend'

// Lazy so `next build` can collect page data without RESEND_API_KEY set
let client: Resend | undefined

export function getResend(): Resend {
  client ??= new Resend(process.env.RESEND_API_KEY)
  return client
}
