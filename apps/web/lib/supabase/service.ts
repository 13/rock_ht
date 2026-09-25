import { createClient } from '@supabase/supabase-js'
import type { Database } from '@rock_ht/types'

export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
