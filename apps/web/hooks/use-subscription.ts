'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Plan } from '@sisigo/utils'

export function useSubscription() {
  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .single()
      return data
    },
    staleTime: 60_000,
  })

  const plan = (data?.plan ?? 'free') as Plan

  return {
    plan,
    isPro: plan === 'pro',
    status: data?.status ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
    isLoading,
  }
}
