// Local verification of wa-webhook pure logic (no Supabase needed).
// Mirrors the signature + parsing/routing rules from the edge function.
import crypto from "node:crypto";
import fs from "node:fs";

const APP_SECRET = "test_app_secret";
let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log((cond ? "PASS" : "FAIL") + " · " + name); };

// ---- signature (same scheme as function) ----
const sign = (raw) => "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
function validSignature(raw, header) {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = sign(raw);
  if (expected.length !== header.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

const raw = fs.readFileSync(new URL("../sample-payload.json", import.meta.url), "utf8");

// 1) signature validation
ok("valid signature accepted", validSignature(raw, sign(raw)));
ok("tampered body rejected", !validSignature(raw + " ", sign(raw)));
ok("missing signature rejected", !validSignature(raw, null));
ok("wrong-secret signature rejected",
   !validSignature(raw, "sha256=" + crypto.createHmac("sha256","other").update(raw).digest("hex")));

// ---- parse / route (mirror of handleMessage decisions) ----
const MAP = { "PHONE_NUMBER_ID_PLACEHOLDER": "client-waytonest" }; // number->client
const AD_MAP = { "120200000000000001": "project-sobha-mullur" };   // ad->project
const seen = new Set();
const leads = []; const events = [];
function ingest(body) {
  for (const entry of body.entry ?? [])
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "messages") continue;
      const v = ch.value ?? {};
      const pid = v.metadata?.phone_number_id;
      const client = MAP[pid];
      if (!client) { events.push({ status: "ignored_unmapped", pid, hasContent: false }); continue; }
      const nameByWa = Object.fromEntries((v.contacts ?? []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        if (seen.has(m.id)) { events.push({ status: "dup", id: m.id }); continue; }
        seen.add(m.id);
        const ref = m.referral;
        const adId = ref?.source_id;
        const project = adId ? (AD_MAP[adId] ?? null) : null;
        leads.push({
          client, name: nameByWa[m.from] || ("WhatsApp " + m.from.slice(-4)),
          phone: m.from, source: "WhatsApp", project,
          attribution: ref ? (ref.source_type === "ad" ? "ad" : ref.source_type) : "unknown",
          adHeadline: ref?.headline ?? null, text: m.text?.body ?? null, id: m.id,
        });
        events.push({ status: "ok", id: m.id });
      }
    }
}

// 2) happy path: mapped number + ad referral -> attributed lead
ingest(JSON.parse(raw));
const L = leads[0];
ok("routed to correct client", L?.client === "client-waytonest");
ok("contact name captured", L?.name === "Asha Verma");
ok("ad referral -> project mapped", L?.project === "project-sobha-mullur");
ok("attribution = ad", L?.attribution === "ad");
ok("ad headline captured", /Sobha Mullur/.test(L?.adHeadline || ""));
ok("message body captured", /pricing/.test(L?.text || ""));

// 3) duplicate delivery (same message id) -> no 2nd lead
const before = leads.length; ingest(JSON.parse(raw));
ok("duplicate delivery ignored", leads.length === before && events.some(e => e.status === "dup"));

// 4) unknown number -> ignored, no content, no lead
const unknown = JSON.parse(raw); unknown.entry[0].changes[0].value.metadata.phone_number_id = "UNKNOWN_ID";
const lb = leads.length; ingest(unknown);
ok("unknown number creates no lead", leads.length === lb);
ok("unknown number stores no content", events.some(e => e.status === "ignored_unmapped" && e.hasContent === false));

// 5) missing referral -> captured, attribution unknown, project null
const noref = JSON.parse(raw);
noref.entry[0].changes[0].value.messages[0].id = "wamid.NOREF1";
delete noref.entry[0].changes[0].value.messages[0].referral;
ingest(noref);
const nr = leads.find(x => x.id === "wamid.NOREF1");
ok("missing referral still captured", !!nr);
ok("missing referral -> attribution unknown", nr?.attribution === "unknown");
ok("missing referral -> project null (needs review)", nr?.project === null);

// 6) batched events (2 entries, 2 messages) all processed
const batch = { entry: [
  { changes: [ { field: "messages", value: { metadata:{phone_number_id:"PHONE_NUMBER_ID_PLACEHOLDER"}, contacts:[{wa_id:"91999",profile:{name:"B1"}}], messages:[{from:"91999",id:"wamid.B1",type:"text",text:{body:"one"}}] } } ] },
  { changes: [ { field: "messages", value: { metadata:{phone_number_id:"PHONE_NUMBER_ID_PLACEHOLDER"}, contacts:[{wa_id:"91888",profile:{name:"B2"}}], messages:[{from:"91888",id:"wamid.B2",type:"text",text:{body:"two"}}] } } ] },
] };
const bb = leads.length; ingest(batch);
ok("batched events: both messages captured", leads.length === bb + 2);

// 7) client isolation: same wa_id under a different client is a separate contact
//    (keyed by client_id+wa_id). Simulated: different number -> different client.
MAP["PID_CLIENT_B"] = "client-other";
const crossA = { entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"PHONE_NUMBER_ID_PLACEHOLDER"},contacts:[{wa_id:"91777",profile:{name:"Shared"}}],messages:[{from:"91777",id:"wamid.CA",type:"text",text:{body:"a"}}]}}]}] };
const crossB = { entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"PID_CLIENT_B"},contacts:[{wa_id:"91777",profile:{name:"Shared"}}],messages:[{from:"91777",id:"wamid.CB",type:"text",text:{body:"b"}}]}}]}] };
ingest(crossA); ingest(crossB);
const a = leads.find(x=>x.id==="wamid.CA"), b = leads.find(x=>x.id==="wamid.CB");
ok("same phone, different client -> isolated leads", a.client==="client-waytonest" && b.client==="client-other");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
