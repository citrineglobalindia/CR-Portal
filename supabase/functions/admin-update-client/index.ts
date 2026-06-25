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

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { error: 'Missing authorization token.' })
    const { data: ures, error: uerr } = await admin.auth.getUser(token)
    if (uerr || !ures?.user) return json(401, { error: 'Invalid session.' })
    const { data: me } = await admin.from('cr_profiles').select('role').eq('id', ures.user.id).maybeSingle()
    if (!me || me.role !== 'admin') return json(403, { error: 'Admin access required.' })

    const b = await req.json().catch(() => ({}))
    const client_id = (b.client_id || '').trim()
    if (!client_id) return json(400, { error: 'client_id is required.' })

    const { data: target } = await admin.from('cr_profiles').select('id,role,client_code').eq('id', client_id).maybeSingle()
    if (!target || target.role !== 'client') return json(404, { error: 'Client not found.' })

    // Optional password reset.
    let password_reset = false
    if (b.new_password) {
      if (String(b.new_password).length < 6) return json(400, { error: 'New password must be at least 6 characters.' })
      const { error: pwerr } = await admin.auth.admin.updateUserById(client_id, { password: String(b.new_password) })
      if (pwerr) return json(400, { error: pwerr.message })
      password_reset = true
    }

    const patch: Record<string, unknown> = {}
    for (const k of ['full_name','company','phone','address','gst_no','website','notify_email','cr_prefix']) {
      if (b[k] !== undefined) patch[k] = (typeof b[k] === 'string' ? b[k].trim() : b[k]) || null
    }

    if (b.logo_base64 && b.logo_name) {
      try {
        const bytes = Uint8Array.from(atob(b.logo_base64), c => c.charCodeAt(0))
        const codeSlug = (String(target.client_code || 'client').toLowerCase().replace(/[^a-z0-9._-]/g, '')) || 'client'
        const safeName = String(b.logo_name).replace(/[^\w.\-]/g, '_')
        const path = `${codeSlug}/${Date.now()}_${safeName}`
        const { error: serr } = await admin.storage.from('cr-logos').upload(path, bytes, {
          contentType: b.logo_type || 'image/png', upsert: true,
        })
        if (serr) return json(400, { error: 'Logo upload failed: ' + serr.message })
        patch.logo_path = path
      } catch (_e) {
        return json(400, { error: 'Could not process the logo image.' })
      }
    }

    if (Object.keys(patch).length === 0 && !password_reset) return json(400, { error: 'Nothing to update.' })
    if (Object.keys(patch).length > 0) {
      const { error: perr } = await admin.from('cr_profiles').update(patch).eq('id', client_id)
      if (perr) return json(400, { error: perr.message })
    }

    return json(200, { ok: true, updated: Object.keys(patch), password_reset })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
