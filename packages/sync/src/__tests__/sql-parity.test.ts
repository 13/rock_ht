import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The sync functions are written once, in db/selfhost/init/02_sync.sql, and copied verbatim into
// the Supabase migration, so both backends merge, report and page changes identically.
const block = (file: string) => {
  const sql = readFileSync(resolve(__dirname, '../../../../', file), 'utf8')
  const start = sql.indexOf('-- >>> SYNC FUNCTIONS')
  const end = sql.indexOf('-- <<< SYNC FUNCTIONS')
  if (start < 0 || end < 0) throw new Error(`markers missing in ${file}`)
  return sql.slice(start, end)
}

describe('sync SQL parity', () => {
  it('self-host and Supabase share identical sync functions', () => {
    expect(block('supabase/migrations/008_sync.sql')).toBe(block('db/selfhost/init/02_sync.sql'))
  })
})
