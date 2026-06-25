import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const APP_URL = 'https://cr-portal.vercel.app'
const LOGO = 'https://cr-portal.vercel.app/stepstones-logo.png'
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
const SC: Record<string, string> = { 'New': '#6b7280', 'In Review': '#d97706', 'Approved': '#6c5ce7', 'In Progress': '#0891b2', 'Done': '#16a34a', 'Rejected': '#dc2626' }
function fmtIST(d: unknown) {
  if (!d) return '—'
  try { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d as string)) + ' IST' } catch (_) { return String(d) }
}
function badge(s: string) {
  const c = SC[s] || '#6b7280'
  return `<span style='display:inline-block;background:${c}1a;color:${c};border:1px solid ${c}55;padding:3px 12px;border-radius:999px;font-weight:700;font-size:12px'>${esc(s)}</span>`
}
function row(k: string, v: string) {
  return `<tr><td style='padding:11px 14px;background:#f7f8fc;border:1px solid #ebedf5;color:#6b7280;width:160px;vertical-align:top;font-weight:600'>${k}</td><td style='padding:11px 14px;border:1px solid #ebedf5;color:#111827'>${v}</td></tr>`
}
function successHero() {
  return `<div style='text-align:center;padding:26px 20px 6px'>
    <div style='width:84px;height:84px;border-radius:50%;background:#16a34a;margin:0 auto;text-align:center;box-shadow:0 8px 22px rgba(22,163,74,.35)'>
      <span style='color:#ffffff;font-size:46px;line-height:84px'>&#10003;</span></div>
    <div style='font-size:24px;font-weight:800;color:#16a34a;margin-top:14px'>Successfully Completed</div>
    <div style='color:#6b7280;font-size:13px;margin-top:4px'>Your change request has been resolved and closed.</div></div>`
}
function shell(title: string, rowsHtml: string, leadHtml: string, attHtml: string, heroHtml: string) {
  return `<div style='background:#eef0f6;padding:24px;font-family:Arial,Helvetica,sans-serif'>
    <div style='max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e3e6f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(17,24,39,.08)'>
      <div style='text-align:center;padding:24px 20px 12px'><img src='${LOGO}' alt='StepStones' style='height:64px'></div>
      <div style='height:4px;background:linear-gradient(90deg,#6c5ce7,#00d2a8)'></div>
      ${heroHtml || ''}
      <div style='padding:${heroHtml ? '12px 26px 26px' : '24px 26px'}'>
        ${title ? `<h2 style='margin:0 0 10px;color:#111827;font-size:20px'>${title}</h2>` : ''}
        ${leadHtml || ''}
        <table style='width:100%;border-collapse:collapse;margin-top:16px;font-size:14px'>${rowsHtml}</table>
        ${attHtml}
        <div style='margin-top:24px;text-align:center'><a href='${APP_URL}' style='background:#6c5ce7;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;display:inline-block'>View in Portal</a></div>
      </div>
      <div style='padding:16px 26px;background:#f7f8fc;border-top:1px solid #ebedf5;color:#9aa0bd;font-size:11px;text-align:center'>Automated message from ${BRAND} &middot; StudioAI Pro Change Request Portal</div>
    </div></div>`
}
async function buildAtt(admin: ReturnType<typeof createClient>, reqId: string) {
  const { data: atts } = await admin.from('cr_attachments').select('*').eq('request_id', reqId).order('created_at')
  if (!atts || !atts.length) return `<div style='margin-top:18px;color:#9aa0bd;font-size:13px'>No attachments on this request.</div>`
  const items: string[] = []
  for (const a of atts) {
    const { data: s } = await admin.storage.from('cr-attachments').createSignedUrl(a.file_path, 604800)
    const link = (s && s.signedUrl) ? s.signedUrl : APP_URL
    const isImg = String(a.mime_type || '').startsWith('image/')
    const cell = isImg
      ? `<a href='${link}'><img src='${link}' alt='${esc(a.file_name)}' style='width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #e3e6f0;vertical-align:middle;margin-right:12px'></a><a href='${link}' style='color:#6c5ce7;text-decoration:none;font-weight:600'>${esc(a.file_name)}</a>`
      : `<span style='margin-right:8px'>📎</span><a href='${link}' style='color:#6c5ce7;text-decoration:none;font-weight:600'>${esc(a.file_name)}</a>`
    items.push(`<tr><td style='padding:9px 0;border-bottom:1px solid #f0f1f7'>${cell}</td></tr>`)
  }
  return `<div style='margin-top:22px'><div style='font-weight:700;color:#111827;margin-bottom:8px;font-size:15px'>Attachments (${atts.length})</div><table style='width:100%;border-collapse:collapse'>${items.join('')}</table></div>`
}
async function sendMail(to: string, subject: string, html: string) {
  const user = Deno.env.get('SMTP_USER'); const pass = Deno.env.get('SMTP_PASS')
  if (!user || !pass) throw new Error('Email not configured: set SMTP_USER and SMTP_PASS secrets.')
  const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } } })
  await client.send({ from: `${BRAND} <${user}>`, to, subject, html, content: 'text/html' })
  await client.close()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const url = Deno.env.get('SUPABASE_URL')!; const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: ures, error: uerr } = await admin.auth.getUser(token)
    if (uerr || !ures?.user) return json(401, { error: 'Invalid session.' })
    const callerId = ures.user.id
    const { kind, request_id, new_status } = await req.json().catch(() => ({}))
    if (!kind || !request_id) return json(400, { error: 'kind and request_id are required.' })
    const { data: cr } = await admin.from('cr_requests').select('*').eq('id', request_id).maybeSingle()
    if (!cr) return json(404, { error: 'Request not found.' })
    const attHtml = await buildAtt(admin, cr.id)
    const raised = fmtIST(cr.created_at)
    const info = `<span style='white-space:pre-wrap'>${esc(cr.description)}</span>`

    if (kind === 'new_cr') {
      if (cr.created_by !== callerId) return json(403, { error: 'Not allowed.' })
      const { data: admins } = await admin.from('cr_profiles').select('notify_email,email').eq('role', 'admin')
      const recipients = (admins || []).map(a => a.notify_email || a.email).filter(Boolean)
      if (!recipients.length) return json(200, { ok: true, skipped: 'no admin recipients' })
      const { data: o } = await admin.from('cr_profiles').select('full_name,company').eq('id', cr.created_by).maybeSingle()
      const lead = `<p style='color:#374151;margin:0'>A new change request has been submitted and needs your attention.</p>`
      const rows = row('Reference', `<b>${esc(cr.ref_no)}</b>`) + row('Client name', esc((o && o.full_name) || cr.client_name)) + row('Project', esc((o && o.company) || cr.client_name)) + row('CR information', esc(cr.title)) + row('Details', info) + row('Priority', badge(cr.priority)) + row('Status', badge(cr.status)) + row('Raised on', raised)
      const html = shell(`New request ${esc(cr.ref_no)}`, rows, lead, attHtml, '')
      for (const to of recipients) await sendMail(to, `New CR ${cr.ref_no} from ${cr.client_name}`, html)
      return json(200, { ok: true, notified: recipients.length })
    }

    if (kind === 'status') {
      const { data: me } = await admin.from('cr_profiles').select('role').eq('id', callerId).maybeSingle()
      if (!me || me.role !== 'admin') return json(403, { error: 'Admin only.' })
      const { data: owner } = await admin.from('cr_profiles').select('notify_email,email,full_name,company').eq('id', cr.created_by).maybeSingle()
      const to = (owner && (owner.notify_email || owner.email)) || null
      if (!to) return json(200, { ok: true, skipped: 'no client email' })
      const clientName = (owner && owner.full_name) || cr.client_name
      const project = (owner && owner.company) || cr.client_name
      const status = new_status || cr.status
      const done = status === 'Done'
      let rows = row('Reference', `<b>${esc(cr.ref_no)}</b>`) + row('Client name', esc(clientName)) + row('Project', esc(project)) + row('CR information', esc(cr.title)) + row('Details', info) + row('Priority', badge(cr.priority)) + row('Status', badge(status)) + row('Raised on', raised)
      let heroHtml = ''; let title = 'Update on your request'
      let lead = `<p style='color:#374151;margin:0'>Hello ${esc(clientName || 'there')}, the status of your change request has been updated.</p>`
      if (done) {
        rows += row('Completed on', fmtIST(cr.updated_at))
        heroHtml = successHero(); title = ''
        lead = `<p style='color:#374151;margin:0;text-align:center'>Hello ${esc(clientName || 'there')}, the work on your request is complete. Here are the details:</p>`
      }
      const subject = done ? `✅ Completed: ${cr.ref_no} — ${cr.title}` : `Your request ${cr.ref_no} is now ${status}`
      await sendMail(to, subject, shell(title, rows, lead, attHtml, heroHtml))
      return json(200, { ok: true, notified: 1, status })
    }
    return json(400, { error: 'Unknown kind.' })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
