import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/server/auth'
import { isSelfHostConfigured } from '@/lib/server/self-host-config'

export const runtime = 'nodejs'

// 404s (not 500s) when this image isn't the self-host one, or self-host env vars are missing —
// see `isSelfHostConfigured`.
export async function GET(req: Request) {
  if (!isSelfHostConfigured()) return new Response('Not found', { status: 404 })
  return toNextJsHandler(getAuth()).GET(req)
}
export async function POST(req: Request) {
  if (!isSelfHostConfigured()) return new Response('Not found', { status: 404 })
  return toNextJsHandler(getAuth()).POST(req)
}
