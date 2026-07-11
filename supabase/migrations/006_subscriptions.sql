-- ============================================================
-- sisiGo: Subscriptions Table
-- ============================================================

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references public.profiles(id) on delete cascade not null unique,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  plan                    text not null default 'free'
                          check (plan in ('free', 'pro')),
  status                  text
                          check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_stripe_customer_idx on public.subscriptions(stripe_customer_id);

comment on table public.subscriptions is 'Subscription records, one per user. Free tier seeded automatically on profile creation.';
comment on column public.subscriptions.plan is 'Billing plan: free or pro.';
comment on column public.subscriptions.status is 'Stripe subscription status; null for free-tier users with no Stripe record.';

-- ── Row Level Security ───────────────────────────────────────

alter table public.subscriptions enable row level security;

-- Users can read their own subscription row
create policy "Users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Only the service role can insert, update, or delete
create policy "Service role manages subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role');

-- ── Auto-seed free subscription on profile creation ──────────

create or replace function public.create_free_subscription()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute function public.create_free_subscription();

-- ── Keep updated_at current ──────────────────────────────────

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
