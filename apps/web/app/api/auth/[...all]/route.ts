import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function GET(req: Request) { return toNextJsHandler(getAuth()).GET(req) }
export async function POST(req: Request) { return toNextJsHandler(getAuth()).POST(req) }
