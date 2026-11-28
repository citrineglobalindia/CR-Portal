// ============================================================================
// StepStones CRM — wa-webhook
// Inbound Click-to-WhatsApp capture + Meta ad attribution.
// Scope: INBOUND ONLY. No outbound replies / bulk / CAPI.
//
// Deploy: supabase functions deploy wa-webhook --no-verify-jwt
// Required secrets (set with `supabase secrets set`):
//   WA_VERIFY_TOKEN   = <random string you also paste into Meta webhook config>
//   WA_APP_SECRET     = <Meta App Secret, used to validate X-Hub-Signature-256>
//   WA_ACCESS_TOKEN   = <System User token; reserved for future media fetch>
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const APP_SECRET   = Deno.env.get("WA_APP_SECRET") ?? "";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Validate Meta's X-Hub-Signature-256 over the RAW request body.
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const expected = "sha256=" + hex(mac);
  // constant-time compare
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

const tsToIso = (t?: string) =>
  t ? new Date(Number(t) * 1000).toISOString() : new Date().toISOString();

// Log a diagnostic event. For unmapped numbers we store number + error only,
// never message content.
async function logEvent(e: {
  phone_number_id?: string; client_id?: string | null;
  signature_valid?: boolean; status: string; detail?: string; payload?: unknown;
}) {
  try { await admin.from("cr_wa_events").insert(e as any); } catch (_) { /* best effort */ }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- 1) Verification challenge (GET) ----
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ---- 2) Signature validation over RAW body ----
  const raw = await req.text();
  const sigOk = await validSignature(raw, req.headers.get("x-hub-signature-256"));
  if (!sigOk) {
    await logEvent({ signature_valid: false, status: "error", detail: "invalid_signature" });
    return new Response("invalid signature", { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  // Always ACK fast so Meta does not retry on our processing time.
  // We process synchronously here but guard every branch; unique constraints
  // make retries/duplicates safe.
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value ?? {};
        const phoneNumberId: string | undefined = value.metadata?.phone_number_id;

        // ---- 3) Route by phone_number_id -> client ----
        const { data: num } = await admin.from("cr_wa_numbers")
          .select("client_id,active").eq("phone_number_id", phoneNumberId ?? "").maybeSingle();

        if (!num || !num.active) {
          // Unmapped / inactive: diagnostic only, NO content, NO lead.
          await logEvent({
            phone_number_id: phoneNumberId, signature_valid: true,
            status: "ignored_unmapped",
            detail: num ? "number inactive" : "number not mapped to a client",
            payload: { phone_number_id: phoneNumberId }, // redacted — no messages
          });
          continue;
        }
        const clientId: string = num.client_id;

        // contacts[] gives profile display name keyed by wa_id
        const nameByWa: Record<string, string> = {};
        for (const c of value.contacts ?? []) {
          if (c.wa_id) nameByWa[c.wa_id] = c.profile?.name ?? "";
        }

        for (const m of value.messages ?? []) {
          await handleMessage(clientId, phoneNumberId, m, nameByWa);
        }

        // statuses[] (delivery/read) are ignored in this inbound-only version.
      }
    }
  } catch (err) {
    await logEvent({ signature_valid: true, status: "error", detail: String((err as Error).message) });
    // Still 200 so Meta does not hammer retries for a transient bug; the event
    // row records the failure for the admin surface.
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});

async function handleMessage(
  clientId: string, phoneNumberId: string | undefined, m: any,
  nameByWa: Record<string, string>,
) {
  const waMessageId: string = m.id;
  const waFrom: string = m.from;                 // sender wa_id (digits)
  const type: string = m.type;

  // ---- dedup by wa_message_id ----
  const { data: dup } = await admin.from("cr_wa_messages")
    .select("id").eq("wa_message_id", waMessageId).maybeSingle();
  if (dup) {
    await logEvent({ phone_number_id: phoneNumberId, client_id: clientId, signature_valid: true, status: "dup", detail: waMessageId });
    return;
  }

  // ---- contact (one per client, scoped) ----
  const displayName = nameByWa[waFrom] || null;
  const nowIso = tsToIso(m.timestamp);
  let contactId: string;
  {
    const { data: existing } = await admin.from("cr_wa_contacts")
      .select("id").eq("client_id", clientId).eq("wa_id", waFrom).maybeSingle();
    if (existing) {
      contactId = existing.id;
      await admin.from("cr_wa_contacts").update({
        last_seen: nowIso, display_name: displayName ?? undefined,
      }).eq("id", contactId);
    } else {
      const { data: ins } = await admin.from("cr_wa_contacts").insert({
        client_id: clientId, wa_id: waFrom, phone: waFrom,
        display_name: displayName, first_seen: nowIso, last_seen: nowIso,
      }).select("id").single();
      contactId = ins!.id;
    }
  }

  // ---- referral / ad attribution (all optional) ----
  const ref = m.referral; // present on the FIRST message of a CTWA thread
  let projectId: string | null = null;
  let attribution = "unknown";
  let adFields: Record<string, unknown> = {};
  if (ref) {
    attribution = ref.source_type === "ad" ? "ad" : (ref.source_type || "unknown");
    const adId = ref.source_id || null;
    adFields = {
      source_type: ref.source_type || null,
      source_id: ref.source_id || null,
      ctwa_clid: ref.ctwa_clid || null,
      ad_id: adId,
      ad_headline: ref.headline || null,
      ad_body: ref.body || null,
      ad_media_url: ref.image_url || ref.video_url || ref.source_url || null,
    };
    if (adId) {
      // CRM admin mapping ad -> project
      const { data: map } = await admin.from("cr_wa_ad_map")
        .select("project_id,campaign_id,adset_id")
        .eq("client_id", clientId).eq("meta_ad_id", adId).maybeSingle();
      if (map) {
        projectId = map.project_id;
        adFields.campaign_id = map.campaign_id ?? null;
        adFields.adset_id = map.adset_id ?? null;
      }
    }
  }

  // ---- find/create enquiry ----
  // Rule: separate enquiry per project. If we know the project, reuse the open
  // enquiry for (contact, project); else reuse an open unknown-project enquiry.
  let enquiryId: string;
  {
    const q = admin.from("cr_wa_enquiries").select("id,project_id")
      .eq("client_id", clientId).eq("contact_id", contactId).neq("status", "closed");
    const { data: openEnqs } = await q;
    let match = null as any;
    if (projectId) match = (openEnqs || []).find((e) => e.project_id === projectId);
    else match = (openEnqs || []).find((e) => !e.project_id) || null;

    if (match) {
      enquiryId = match.id;
      await admin.from("cr_wa_enquiries").update({
        last_message_at: nowIso,
        ...(ref ? adFields : {}),
        ...(projectId ? { project_id: projectId, attribution } : {}),
      }).eq("id", enquiryId);
    } else {
      const { data: ins } = await admin.from("cr_wa_enquiries").insert({
        client_id: clientId, contact_id: contactId, project_id: projectId,
        attribution, status: "open",
        first_message_at: nowIso, last_message_at: nowIso, ...adFields,
      }).select("id").single();
      enquiryId = ins!.id;
    }
  }

  // ---- message (dedup enforced by unique wa_message_id) ----
  const text = m.text?.body
    ?? m.button?.text
    ?? m.interactive?.list_reply?.title
    ?? m.interactive?.button_reply?.title
    ?? null;
  const mediaMeta = ["image", "audio", "video", "document", "sticker"].includes(type)
    ? (m[type] ?? null) : null; // {id,mime_type,sha256,filename,caption?} — metadata only
  try {
    await admin.from("cr_wa_messages").insert({
      enquiry_id: enquiryId, client_id: clientId, wa_message_id: waMessageId,
      direction: "in", wa_from: waFrom, wa_timestamp: nowIso,
      msg_type: type, body: text, media_meta: mediaMeta, referral: ref ?? null,
    });
  } catch (_) {
    // unique violation => concurrent duplicate delivery; safe to ignore
    await logEvent({ phone_number_id: phoneNumberId, client_id: clientId, signature_valid: true, status: "dup", detail: waMessageId });
    return;
  }

  // ---- reuse the lead lifecycle (cr_leads + cr_lead_activities) ----
  await upsertLead(clientId, enquiryId, contactId, projectId, displayName, waFrom, text, adFields);

  await logEvent({ phone_number_id: phoneNumberId, client_id: clientId, signature_valid: true, status: "ok", detail: enquiryId });
}

async function upsertLead(
  clientId: string, enquiryId: string, contactId: string, projectId: string | null,
  name: string | null, phone: string, text: string | null, adFields: Record<string, unknown>,
) {
  // one lead per enquiry (tracked via cr_wa_enquiries.lead_id)
  const { data: enq } = await admin.from("cr_wa_enquiries").select("lead_id").eq("id", enquiryId).maybeSingle();
  if (enq?.lead_id) {
    await admin.from("cr_leads").update({ last_contact: new Date().toISOString() }).eq("id", enq.lead_id);
    await admin.from("cr_lead_activities").insert({
      lead_id: enq.lead_id, type: "whatsapp",
      note: "WhatsApp: " + (text ? text.slice(0, 500) : "[" + "media/other" + "]"),
      actor: null, actor_name: "WhatsApp",
    });
    return;
  }
  const { data: lead } = await admin.from("cr_leads").insert({
    name: name || ("WhatsApp " + phone.slice(-4)),
    phone, source: "WhatsApp", stage: "new", temp: "warm",
    client_id: clientId, project_id: projectId,
    meta_ad_id: (adFields.ad_id as string) ?? null,
    wa_enquiry_id: enquiryId, wa_contact_id: contactId,
    owner_name: "WhatsApp", created_by_name: "WhatsApp",
  }).select("id").single();
  await admin.from("cr_wa_enquiries").update({ lead_id: lead!.id }).eq("id", enquiryId);
  await admin.from("cr_lead_activities").insert({
    lead_id: lead!.id, type: "whatsapp",
    note: "First WhatsApp enquiry" + (adFields.ad_headline ? " · Ad: " + adFields.ad_headline : ""),
    actor: null, actor_name: "WhatsApp",
  });
}
