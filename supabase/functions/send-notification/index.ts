import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const APP_URL = 'https://cr-portal.vercel.app'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

async function sendMail(to: string, subject: string, html: string) {
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (!user || !pass) throw new Error('Email not configured: set SMTP_USER and SMTP_PASS secrets.')
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } },
  })
  await client.send({ from: `CR Portal <${user}>`, to, subject, html, content: 'text/html' })
  await client.close()
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
    const callerId = ures.user.id

    const { kind, request_id, new_status } = await req.json().catch(() => ({}))
    if (!kind || !request_id) return json(400, { error: 'kind and request_id are required.' })

    const { data: cr } = await admin.from('cr_requests').select('*').eq('id', request_id).maybeSingle()
    if (!cr) return json(404, { error: 'Request not found.' })

    const link = `<p><a href="${APP_URL}">Open the CR Portal</a></p>`
    const base = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">`

    if (kind === 'new_cr') {
      if (cr.created_by !== callerId) return json(403, { error: 'Not allowed.' })
      const { data: admins } = await admin.from('cr_profiles').select('notify_email,email').eq('role', 'admin')
      const recipients = (admins || []).map(a => a.notify_email || a.email).filter(Boolean)
      if (!recipients.length) return json(200, { ok: true, skipped: 'no admin recipients' })
      const html = `${base}<h2>New Change Request: ${esc(cr.ref_no)}</h2>
        <p><b>Client:</b> ${esc(cr.client_name)}</p>
        <p><b>Heading:</b> ${esc(cr.title)}</p>
        <p><b>Priority:</b> ${esc(cr.priority)}</p>
        <p><b>Description:</b><br>${esc(cr.description).replace(/\n/g, '<br>')}</p>${link}</div>`
      for (const to of recipients) await sendMail(to, `New CR ${cr.ref_no} from ${cr.client_name}`, html)
      return json(200, { ok: true, notified: recipients.length })
    }

    if (kind === 'status') {
      const { data: me } = await admin.from('cr_profiles').select('role').eq('id', callerId).maybeSingle()
      if (!me || me.role !== 'admin') return json(403, { error: 'Admin only.' })
      const { data: owner } = await admin.from('cr_profiles').select('notify_email,email,full_name,company').eq('id', cr.created_by).maybeSingle()
      const to = owner?.notify_email || owner?.email
      if (!to) return json(200, { ok: true, skipped: 'no client email' })
      const html = `${base}<h2>Update on ${esc(cr.ref_no)}</h2>
        <p>Hello ${esc(owner?.full_name || owner?.company || 'there')},</p>
        <p>Your change request <b>${esc(cr.title)}</b> is now:</p>
        <p style="font-size:18px"><b>${esc(new_status || cr.status)}</b></p>${link}</div>`
      await sendMail(to, `Your request ${cr.ref_no} is now ${new_status || cr.status}`, html)
      return json(200, { ok: true, notified: 1 })
    }

    return json(400, { error: 'Unknown kind.' })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
