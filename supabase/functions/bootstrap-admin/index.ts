import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Only allowed before any admin exists.
    const { count } = await admin.from('cr_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
    if ((count ?? 0) > 0) return json(403, { error: 'Setup already complete. An admin already exists.' })

    const body = await req.json().catch(() => ({}))
    const email = (body.email || '').trim()
    const password = body.password || ''
    const full_name = (body.full_name || '').trim()
    if (!email || password.length < 6) return json(400, { error: 'Email and a 6+ character password are required.' })

    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: full_name || email },
    })
    if (cerr) return json(400, { error: cerr.message })
    const uid = created.user?.id
    if (!uid) return json(500, { error: 'User creation returned no id.' })

    const { error: perr } = await admin.from('cr_profiles').upsert({
      id: uid, email, notify_email: email, full_name: full_name || email, role: 'admin',
    })
    if (perr) { await admin.auth.admin.deleteUser(uid); return json(400, { error: perr.message }) }

    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
