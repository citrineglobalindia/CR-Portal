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

    // Authenticate the caller and require admin role.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { error: 'Missing authorization token.' })
    const { data: ures, error: uerr } = await admin.auth.getUser(token)
    if (uerr || !ures?.user) return json(401, { error: 'Invalid session.' })
    const { data: me } = await admin.from('cr_profiles').select('role').eq('id', ures.user.id).maybeSingle()
    if (!me || me.role !== 'admin') return json(403, { error: 'Admin access required.' })

    const b = await req.json().catch(() => ({}))
    const username = (b.username || '').trim()
    const password = b.password || ''
    const notify_email = (b.email || '').trim()
    const client_code = (b.client_code || '').trim()
    if (!username || password.length < 6 || !notify_email || !client_code)
      return json(400, { error: 'username, a 6+ char password, email and client_code are required.' })

    const slug = username.toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (!slug) return json(400, { error: 'username must contain letters or numbers.' })
    const loginEmail = `${slug}@clients.crportal.app`

    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email: loginEmail, password, email_confirm: true,
      user_metadata: { username, full_name: b.full_name || username },
    })
    if (cerr) return json(400, { error: cerr.message })
    const uid = created.user?.id
    if (!uid) return json(500, { error: 'User creation returned no id.' })

    const { error: perr } = await admin.from('cr_profiles').insert({
      id: uid, email: loginEmail, notify_email, username,
      full_name: b.full_name || null, company: b.company || null, phone: b.phone || null,
      address: b.address || null, gst_no: b.gst_no || null, website: b.website || null,
      client_code, logo_path: b.logo_path || null, role: 'client',
    })
    if (perr) { await admin.auth.admin.deleteUser(uid); return json(400, { error: perr.message }) }

    return json(200, { ok: true, login_email: loginEmail, user_id: uid })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
