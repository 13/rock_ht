import Stripe from 'stripe'

// Lazy so `next build` can collect page data without STRIPE_SECRET_KEY set
let client: Stripe | undefined

export function getStripe(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
    typescript: true,
  })
  return client
}
