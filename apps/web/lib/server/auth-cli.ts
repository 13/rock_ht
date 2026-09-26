// Entry point for the Better Auth CLI only, which needs an exported `auth` instance
// (the app itself uses the lazy getAuth()). The CLI introspects DATABASE_URL and emits only
// the tables it is missing, so point it at a database with 01/02 loaded but no auth tables:
//   cd apps/web && DATABASE_URL=postgres://postgres:pg@localhost:55432/postgres \
//     npx auth@1.7.6 generate --config lib/server/auth-cli.ts \
//     --output ../../db/selfhost/init/03_auth.sql --yes
import { getAuth } from './auth'

export const auth = getAuth()
