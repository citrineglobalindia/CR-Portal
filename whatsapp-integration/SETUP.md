# StepStones CRM — Inbound Click-to-WhatsApp Lead Capture

Inbound only: captures WhatsApp enquiries into the CRM and attributes them to the
Meta ad / project when a Click-to-WhatsApp referral is present. No outbound
replies, bulk messaging, paid providers, or Conversions API in this version.

## What's in this folder
- `supabase/migrations/20261128_whatsapp_inbound.sql` — additive, safe migration
  (new tables + RLS + optional `cr_leads` back-link columns). Nothing is dropped.
- `supabase/functions/wa-webhook/index.ts` — the webhook (verify + ingest).
- `sample-payload.json` — fictional CTWA message to test with.
- `env.example` — secret names with placeholders.

## 1. Apply the migration (needs Supabase admin on project kiwyasoqgsydpofaffyp)
Open the Supabase SQL editor and run the migration file, OR:
```
supabase link --project-ref kiwyasoqgsydpofaffyp
supabase db push      # or paste the SQL into the SQL editor
```
It creates: `cr_wa_numbers`, `cr_wa_ad_map`, `cr_wa_contacts`, `cr_wa_enquiries`,
`cr_wa_messages`, `cr_wa_events`, and adds nullable back-link columns to `cr_leads`.

## 2. Set secrets and deploy the function
```
supabase secrets set WA_VERIFY_TOKEN="<long-random-string>"
supabase secrets set WA_APP_SECRET="<Meta App Secret>"
supabase secrets set WA_ACCESS_TOKEN="<System User token>"   # reserved, future media fetch
supabase functions deploy wa-webhook --no-verify-jwt
```
Webhook URL: `https://kiwyasoqgsydpofaffyp.functions.supabase.co/wa-webhook`

## 3. Configure Meta (production — do with approval)
1. Meta App → WhatsApp → Configuration → Webhooks.
2. Callback URL = the function URL above; Verify token = `WA_VERIFY_TOKEN`.
   Meta sends a GET challenge; the function echoes `hub.challenge` on match.
3. Subscribe the WABA to the **messages** field.
4. Permissions required: `whatsapp_business_messaging`,
   `whatsapp_business_management` (and your existing `ads_read` for ad lookups).
5. Click-to-WhatsApp referral fields (`messages[].referral`) require the ad to be a
   CTWA ad; referral is present only on the **first** message of the thread.

## 4. Map one authorised client number (pilot: Way To Nest)
In the CRM → **Ad Analytics → WhatsApp** (admin only):
- Add a number: paste the WhatsApp **phone_number_id** (from Meta → WhatsApp →
  API Setup) and pick the client (**Way To Nest**).
- Map ads → projects: paste a Meta **ad id** and choose the Way To Nest project.
  (Unmapped ads still capture the enquiry; it shows as "needs review".)

## 5. Test one real Click-to-WhatsApp enquiry
- From a test phone, tap a Way To Nest CTWA ad → send a message.
- In **Leads**, filter **Source = WhatsApp**: the enquiry appears with the sender,
  message, first-enquiry time, client (Way To Nest), project, and the ad headline.
- Local test without Meta: see `test/` — it signs `sample-payload.json` with
  `WA_APP_SECRET` and POSTs it; verifies signature rejection, dedup, batching,
  unknown number, and missing referral.

## Behaviour summary (acceptance)
- **Verification**: GET with correct `hub.verify_token` → 200 + challenge; wrong → 403.
- **Invalid signature**: POST with bad/no `X-Hub-Signature-256` → 401, no lead,
  diagnostic row `status=error detail=invalid_signature`.
- **Unknown number**: 200, `status=ignored_unmapped`, **no content stored**, no lead.
- **Duplicate delivery**: same `wa_message_id` → ignored (`status=dup`), no 2nd lead.
- **Batched events**: every entry/change/message iterated; each handled independently.
- **Missing referral**: captured anyway; enquiry `attribution=unknown`, project null,
  shown as "WhatsApp · Source unknown" with an assign-project control.
- **Repeat enquiries**: same contact + same project → appended to the open enquiry;
  different project → a new enquiry. One contact row per client.
- **Client isolation**: contacts/enquiries/messages are keyed by `client_id`;
  RLS limits reads to staff / the owning client; ingest is service-role only.

## Steps that need YOUR access (cannot be done from here)
- Running the migration + deploying the function (needs Supabase admin on the
  live project — the assistant's DB tool is currently on a different account).
- All Meta App config: webhook subscription, verify token, app secret, CTWA
  permissions, and reading each client's `phone_number_id`.
