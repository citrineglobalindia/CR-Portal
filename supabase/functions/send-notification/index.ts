import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const APP_URL = 'https://cr-portal.vercel.app'
const BRAND = 'Stepstones Global India'
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
const STATUS_COLORS: Record<string, string> = { 'New': '#9aa0bd', 'In Review': '#ffb020', 'Approved': '#6c5ce7', 'In Progress': '#00d2a8', 'Done': '#22c55e', 'Rejected': '#ff6b6b' }

function shell(title: string, bodyHtml: string) {
  return `<div style="background:#0f1220;padding:24px;font-family:Segoe UI,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#171a2b;border:1px solid #2a2f4a;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#6c5ce7,#00d2a8);padding:18px 22px;color:#fff">
        <div style="font-size:18px;font-weight:800">Change Request Portal</div>
        <div style="font-size:12px;opacity:.9">StudioAI Pro &middot; ${BRAND}</div>
      </div>
      <div style="padding:22px;color:#e7e9f3;font-size:14px;line-height:1.6">
        <h2 style="margin:0 0 12px;color:#fff;font-size:18px">${title}</h2>
        ${bodyHtml}
        <div style="margin-top:22px"><a href="${APP_URL}" style="display:inline-block;background:#6c5ce7;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Open the portal</a></div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid #2a2f4a;color:#9aa0bd;font-size:11px">This is an automated message from the ${BRAND} Change Request Portal.</div>
    </div></div>`
}
function badge(status: string) {
  const c = STATUS_COLORS[status] || '#9aa0bd'
  return `<span style="display:inline-block;background:${c}22;color:${c};border:1px solid ${c}55;padding:3px 12px;border-radius:999px;font-weight:700;font-size:13px">${esc(status)}</span>`
}

async function sendMail(to: string, subject: string, html: string) {
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (!user || !pass) throw new Error('Email not configured: set SMTP_USER and SMTP_PASS secrets.')
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } },
  })
  await client.send({ from: `${BRAND} <${user}>`, to, subject, html, content: 'text/html' })
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

    if (kind === 'new_cr') {
      if (cr.created_by !== callerId) return json(403, { error: 'Not allowed.' })
      const { data: admins } = await admin.from('cr_profiles').select('notify_email,email').eq('role', 'admin')
      const recipients = (admins || []).map(a => a.notify_email || a.email).filter(Boolean)
      if (!recipients.length) return json(200, { ok: true, skipped: 'no admin recipients' })
      const body = `<p>A new change request has been submitted.</p>
        <p><b>Reference:</b> ${esc(cr.ref_no)}<br><b>Client:</b> ${esc(cr.client_name)}<br><b>Priority:</b> ${esc(cr.priority)}</p>
        <p><b>${esc(cr.title)}</b></p>
        <p style="color:#9aa0bd">${esc(cr.description).replace(/\n/g, '<br>')}</p>`
      const html = shell(`New request ${esc(cr.ref_no)}`, body)
      for (const to of recipients) await sendMail(to, `New CR ${cr.ref_no} from ${cr.client_name}`, html)
      return json(200, { ok: true, notified: recipients.length })
    }

    if (kind === 'status') {
      const { data: me } = await admin.from('cr_profiles').select('role').eq('id', callerId).maybeSingle()
      if (!me || me.role !== 'admin') return json(403, { error: 'Admin only.' })
      const { data: owner } = await admin.from('cr_profiles').select('notify_email,email,full_name,company').eq('id', cr.created_by).maybeSingle()
      const to = owner?.notify_email || owner?.email
      if (!to) return json(200, { ok: true, skipped: 'no client email' })
      const status = new_status || cr.status
      const hi = `<p>Hello ${esc(owner?.full_name || owner?.company || 'there')},</p>`
      let title: string, lead: string, subject: string
      if (status === 'Done') {
        title = `✅ Completed: ${esc(cr.ref_no)}`
        lead = `<p>Good news — your change request has been <b>completed</b>.</p>`
        subject = `✅ Your request ${cr.ref_no} is completed`
      } else {
        title = `Update on ${esc(cr.ref_no)}`
        lead = `<p>The status of your change request has been updated.</p>`
        subject = `Your request ${cr.ref_no} is now ${status}`
      }
      const body = `${hi}${lead}
        <p><b>${esc(cr.title)}</b></p>
        <p>Current status: ${badge(status)}</p>`
      await sendMail(to, subject, shell(title, body))
      return json(200, { ok: true, notified: 1, status })
    }

    return json(400, { error: 'Unknown kind.' })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
