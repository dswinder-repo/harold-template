import { createBrowserClient } from '@supabase/ssr'
import { supabaseUrlOrPlaceholder, supabaseKeyOrPlaceholder } from './env'

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  // Demo mode runs the real pages against invented fixtures (lib/demo), so the
  // interface can be shown without a database and without anybody's real contacts.
  //
  // The check is written against process.env directly, and the demo module is pulled
  // in inside the branch rather than imported at the top. next.config.ts defaults the
  // flag to '0', so in a normal build the bundler sees a constant false and drops
  // the branch, the demo client and the fixtures entirely.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createDemoClient } = require('@/lib/demo/client')
    return createDemoClient() as unknown as ReturnType<typeof createBrowserClient>
  }
  if (!client) {
    client = createBrowserClient(supabaseUrlOrPlaceholder, supabaseKeyOrPlaceholder)
  }
  return client
}
