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
    const { data: ures, error: uerr } = await admin.auth.getUser(token)
    if (uerr || !ures?.user) return json(401, { error: 'Invalid session.' })
    const { data: me } = await admin.from('cr_profiles').select('role,full_name').eq('id', ures.user.id).maybeSingle()
    if (!me || me.role !== 'admin') return json(403, { error: 'Admin access required.' })

    const b = await req.json().catch(() => ({}))
    const client_id = (b.client_id || '').trim()
    const title = (b.title || '').trim()
    const description = (b.description || '').trim()
    if (!client_id || !title || !description) return json(400, { error: 'client_id, title and description are required.' })

    const { data: client } = await admin.from('cr_profiles').select('id,role,full_name,company,username').eq('id', client_id).maybeSingle()
    if (!client || client.role !== 'client') return json(404, { error: 'Client not found.' })

    const { data: cr, error: ierr } = await admin.from('cr_requests').insert({
      title, description,
      area: b.area || 'Other', type: b.type || 'Change', priority: b.priority || 'Medium',
      item_count: 1, due_date: b.due_date || null, status: 'New',
      created_by: client_id, client_name: client.company || client.full_name || client.username,
    }).select().single()
    if (ierr) return json(400, { error: ierr.message })

    await admin.from('cr_status_history').insert({
      request_id: cr.id, old_status: null, new_status: 'New',
      changed_by: ures.user.id, changed_by_name: me.full_name || 'Admin',
      note: 'Raised by admin on behalf of client',
    })

    return json(200, { ok: true, id: cr.id, ref_no: cr.ref_no })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
