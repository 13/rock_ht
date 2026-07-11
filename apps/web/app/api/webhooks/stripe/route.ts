import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = (await headers()).get('stripe-signature')

  if (!sig) return new Response('Missing stripe-signature header', { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 })
  }

  const supabase = createServiceClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription' || !session.subscription) break
      const customerId = session.customer as string
      const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string)
      await supabase.from('subscriptions').update({
        stripe_subscription_id: stripeSub.id,
        plan: 'pro',
        status: stripeSub.status,
        current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const isActive = ['active', 'trialing'].includes(sub.status)
      await supabase.from('subscriptions').update({
        stripe_subscription_id: sub.id,
        plan: isActive ? 'pro' : 'free',
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('stripe_customer_id', sub.customer as string)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await supabase.from('subscriptions').update({
        plan: 'free',
        status: 'canceled',
        stripe_subscription_id: null,
        current_period_end: null,
      }).eq('stripe_customer_id', sub.customer as string)
      break
    }

    default:
      // Unhandled event type — acknowledge receipt so Stripe stops retrying
      break
  }

  return new Response('ok', { status: 200 })
}
