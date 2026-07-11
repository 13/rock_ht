export interface SubscriptionRow {
  id: string
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'free' | 'pro'
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}
