// POST /api/webhooks/vapi — Vapi posts end-of-call reports + function calls here.
// Maps the Vapi assistant ID to our client_id, then inserts call_logs / appointments.
// Configure Vapi assistant Server URL = https://apextoolsai.com/api/webhooks/vapi
import { json, newId, logUsage, sendSMS, sendEmail, escapeHtml } from '../../_lib.js';
import { pushAppointmentToAll } from '../../_integrations.js';
import { ensureAssistantSynced } from '../../_vapi.js';

// Comprehensive phone-number parser. Handles every natural way a US caller
// might give their 10-digit number — including compound numbers, pairs,
// mixed English/Spanish, leading 1 country code, and pre-formatted strings.
// Returns 10-digit string or null if not parseable.
function parsePhoneNumber(input) {
  if (!input) return null;
  let s = String(input).toLowerCase()
    .replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c] || c))
    .replace(/ñ/g,'n')
    .replace(/[¿¡?!.]/g, ' ')
    .replace(/[-–—_]/g, ' ')
    .replace(/[(),]/g, ' ');

  // Single digit words → digit
  const ones = {
    'zero':0,'oh':0,'cero':0,'o':0,
    'one':1,'uno':1,'una':1,
    'two':2,'dos':2,
    'three':3,'tres':3,
    'four':4,'cuatro':4,
    'five':5,'cinco':5,
    'six':6,'seis':6,
    'seven':7,'siete':7,
    'eight':8,'ocho':8,
    'nine':9,'nueve':9,
  };
  // Teens
  const teens = {
    'ten':10,'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,
    'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,
    'diez':10,'once':11,'doce':12,'trece':13,'catorce':14,'quince':15,
    'dieciseis':16,'diecisiete':17,'dieciocho':18,'diecinueve':19,
  };
  // Tens
  const tens = {
    'twenty':20,'thirty':30,'forty':40,'fourty':40,'fifty':50,
    'sixty':60,'seventy':70,'eighty':80,'ninety':90,
    'veinte':20,'treinta':30,'cuarenta':40,'cincuenta':50,
    'sesenta':60,'setenta':70,'ochenta':80,'noventa':90,
  };
  // Spanish "veinti..." compound shortcuts
  const veintis = {
    'veintiuno':21,'veintidos':22,'veintitres':23,'veinticuatro':24,
    'veinticinco':25,'veintiseis':26,'veintisiete':27,'veintiocho':28,'veintinueve':29,
  };
  // Hundred
  const hundredWord = /^(hundred|cien|ciento|cientos)$/;
  // "and" / "y" connector
  const connector = /^(and|y)$/;

  // First pass: tokenize and convert each token to digit string
  const tokens = s.split(/\s+/).filter(Boolean);
  let digits = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // pure digits already in token
    if (/^[0-9]+$/.test(t)) { digits += t; continue; }
    // "veinticuatro" type Spanish compounds
    if (veintis[t] !== undefined) { digits += String(veintis[t]).padStart(2,'0'); continue; }
    // teens 10-19
    if (teens[t] !== undefined) { digits += String(teens[t]).padStart(2,'0'); continue; }
    // tens (twenty, thirty, ...)
    if (tens[t] !== undefined) {
      const tensVal = tens[t];
      // look ahead — possibly followed by "and"/"y" then a single digit
      let next = tokens[i+1];
      if (next && connector.test(next)) { i++; next = tokens[i+1]; }
      if (next && ones[next] !== undefined) {
        digits += String(tensVal + ones[next]).padStart(2,'0');
        i++;
      } else {
        digits += String(tensVal).padStart(2,'0');
      }
      continue;
    }
    // single digits
    if (ones[t] !== undefined) { digits += String(ones[t]); continue; }
    // hundred word — multiplier (e.g. "two hundred" = "200")
    if (hundredWord.test(t)) {
      // back-multiply: take the last digit and turn it into N00
      if (digits.length > 0) {
        const last = digits.slice(-1);
        digits = digits.slice(0,-1) + last + '00';
      }
      continue;
    }
    // unknown token — skip
  }

  if (!digits) return null;

  // Strip leading 1 if exactly 11 digits (US country code)
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  // If duplicated (e.g. AI passed it twice), take first 10
  if (digits.length > 10 && digits.length % 10 === 0) digits = digits.slice(0, 10);
  if (digits.length > 10) digits = digits.slice(-10); // last-resort: take last 10

  return digits.length === 10 ? digits : null;
}



// Send the AI a language-matched check-in via Vapi's say API after a delay.
// This replaces Vapi's static idleMessages so the prompt language matches
// the call language (which Vapi can't do natively).
async function ensureSilenceCheck(env, callId, client, assistantId) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const idleTimeoutMs = 8000;
  const maxIdle = 2;
  const spawnedAt = Date.now();
  const diag = async (event, data = {}) => {
    try { await env.DB.prepare("INSERT INTO usage_events (client_id, event_type, event_data_json, created_at) VALUES (?, ?, ?, ?)").bind(client.id, 'silence_diag', JSON.stringify({ event, callId, ...data }), Date.now()).run(); } catch {}
  };
  await diag('handler_entered', { spawnedAt });

  for (let i = 0; i < maxIdle; i++) {
    await diag('waiting', { iteration: i });
    await wait(idleTimeoutMs);
    await diag('woke_up', { iteration: i });

    let state;
    try {
      state = await env.DB.prepare(
        'SELECT last_user_speech_at, lang, idle_count, user_speaking, hung_up, control_url FROM call_silence_state WHERE call_id = ?'
      ).bind(callId).first();
    } catch (e) { await diag('state_read_error', { err: String(e) }); return; }

    await diag('state_read', state || { state: 'null' });
    if (!state) return;
    if (state.hung_up) { await diag('aborted_hung_up'); return; }
    if (state.user_speaking) { await diag('aborted_user_speaking'); return; }
    if (state.idle_count >= maxIdle) { await diag('aborted_max_idle'); return; }
    // Stale-handler protection: if user spoke AFTER this handler was spawned,
    // a newer handler already covers the current silence period. Abort.
    if (state.last_user_speech_at && state.last_user_speech_at > spawnedAt) {
      await diag('aborted_stale_handler', { spawnedAt, last_user_speech_at: state.last_user_speech_at });
      return;
    }

    const lang = state.lang || 'en';
    const prompts = [
      lang === 'es' ? '¿Hola? ¿Sigue ahí?' : 'Hello? Are you still there?',
      lang === 'es' ? 'Tómese su tiempo, lo escucho.' : "Take your time, I am here whenever you're ready.",
    ];
    const message = prompts[state.idle_count] || prompts[0];

    if (!env.VAPI_ORG_TOKEN) { await diag('no_token'); return; }

    // Use the per-call controlUrl that Vapi provides in webhook payload at
    // msg.call.monitor.controlUrl. This is the documented endpoint (not
    // api.vapi.ai/call/{id}/control which 404s).
    if (!state.control_url) { await diag('no_control_url'); continue; }
    let anyOk = false;
    try {
      const r = await fetch(state.control_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'say', message, endCallAfterSpoken: false }),
      });
      const respText = await r.text();
      await diag('say_api_response', { url: state.control_url, status: r.status, ok: r.ok, body: respText.slice(0, 300) });
      if (r.ok) anyOk = true;
    } catch (e) {
      await diag('say_api_throw', { err: String(e) });
    }
    if (anyOk) {
      await env.DB.prepare('UPDATE call_silence_state SET idle_count = idle_count + 1 WHERE call_id = ?').bind(callId).run();
    }
  }
  try { await env.DB.prepare('UPDATE call_silence_state SET check_in_progress = 0 WHERE call_id = ?').bind(callId).run(); } catch {}
  await diag('handler_complete');
}


export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ ok: true }); }

  const msg = body?.message || {};
  const type = msg.type;

  // Find the client this event belongs to
  const assistantId = msg.assistant?.id || msg.call?.assistantId;
  let client = null;
  if (assistantId) {
    client = await env.DB.prepare('SELECT id, business_name, escalation_phone, notify_urgent, notify_appointment FROM clients WHERE vapi_assistant_id = ?').bind(assistantId).first();
  }
  if (!client) {
    // Unknown assistant — just acknowledge, log for debugging
    console.log('[vapi-webhook] unknown assistant', assistantId, type);
    return json({ ok: true, ignored: true });
  }

  // Diagnostic: log every event type Vapi sends so we can debug what's actually
  // arriving at this webhook.
  try {
    await logUsage(env, client.id, 'vapi_webhook_event', { type, callId: msg.call?.id, role: msg.role, status: msg.status });
  } catch (e) { /* ignore */ }

  // Force a fresh re-sync on every new call's status-update with status='in-progress'
  // so the AI's prompt always has the current time. Without this, the time
  // baked into the prompt at last sync becomes stale within hours, and the AI
  // offers past time slots (e.g. 2 PM today when it's actually 7 PM).
  // This is fire-and-forget and uses ctx.waitUntil so it doesn't block the response.
  if (type === 'status-update' && msg.status === 'in-progress') {
    try {
      const { syncAssistant } = await import('../../_vapi.js');
      const fullClient = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(client.id).first();
      if (fullClient && fullClient.vapi_assistant_id) {
        const syncPromise = syncAssistant(env, fullClient).then(r => {
          return logUsage(env, client.id, 'call_start_resync', { ok: r.ok }).catch(() => {});
        });
        if (context.waitUntil) context.waitUntil(syncPromise);
      }
    } catch (e) { console.error('[call-start resync]', e); }
  }

  // Auto-sync the live Vapi assistant if the latest deploy bumped PROMPT_VERSION.
  // Most calls this is a no-op (cheap field check). Only runs syncAssistant on the
  // first call after a deploy with a higher version number.
  try {
    const sync = await ensureAssistantSynced(env, client);
    if (sync && !sync.skipped && sync.ok) {
      await logUsage(env, client.id, 'assistant_auto_synced', { version: sync.version });
    } else if (sync && !sync.skipped && !sync.ok) {
      await logUsage(env, client.id, 'assistant_auto_sync_failed', { error: sync.error });
    }
  } catch (e) { console.error('[ensureAssistantSynced]', e); }

  // ---- END OF CALL REPORT ----
  if (type === 'end-of-call-report') {
    const call = msg.call || {};
    const transcript = msg.transcript || msg.artifact?.transcript || '';
    const recordingUrl = msg.recordingUrl || msg.artifact?.recordingUrl || null;
    const callerNumber = msg.customer?.number || call.customer?.number || '';
    const language = (msg.detectedLanguage || transcript.match(/[áéíóúñ¿¡]/) ? 'es' : 'en');
    const endedReason = msg.endedReason || call.endedReason || 'unknown';
    const durationSec = msg.durationSeconds || call.durationSeconds || (msg.endedAt && msg.startedAt ? Math.round((new Date(msg.endedAt) - new Date(msg.startedAt))/1000) : 0);
    const summary = msg.summary || '';
    const wasUrgent = /urgent|emergency|severe pain|bleeding|broken tooth|swelling/i.test(transcript + ' ' + summary) ? 1 : 0;
    const wasBooked = /confirm|booked|scheduled|appointment.{0,20}(set|confirmed)/i.test(summary) ? 1 : 0;
    const costCents = Math.round((msg.cost || 0) * 100);
    const startedAt = msg.startedAt ? new Date(msg.startedAt).getTime() : Date.now();
    const endedAt = msg.endedAt ? new Date(msg.endedAt).getTime() : Date.now();

    const id = newId('cl');
    await env.DB.prepare(
      `INSERT INTO call_logs (id, client_id, vapi_call_id, caller_number, duration_seconds, language, ended_reason, transcript, recording_url, was_appointment_booked, was_urgent, cost_cents, call_started_at, call_ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vapi_call_id) DO NOTHING`
    ).bind(id, client.id, call.id || msg.call?.id || null, callerNumber, durationSec, language, endedReason, transcript, recordingUrl, wasBooked, wasUrgent, costCents, startedAt, endedAt, Date.now()).run();

    await logUsage(env, client.id, 'call_received', { duration: durationSec, language, urgent: !!wasUrgent });

    // Send urgent-call SMS to the practice's escalation phone (respects notify_urgent toggle)
    if (wasUrgent && (client.notify_urgent === 1 || client.notify_urgent === null)) {
      const langLabel = language === 'es' ? 'Spanish' : 'English';
      const businessName = client.business_name || 'your practice';
      const summarySnippet = (summary || transcript || '').substring(0, 220);
      // SMS
      if (client.escalation_phone) {
        try {
          const urgentBody = `URGENT call to ${businessName}\nFrom: ${callerNumber || 'unknown'}\nLanguage: ${langLabel}\nSummary: ${summarySnippet}\n\nReply or call back ASAP.`;
          const smsRes = await sendSMS(env, { to: client.escalation_phone, body: urgentBody });
          if (smsRes.ok) await logUsage(env, client.id, 'urgent_sms_sent', { sid: smsRes.sid });
          else await logUsage(env, client.id, 'urgent_sms_failed', { reason: smsRes.reason });
        } catch (e) { console.error('[urgent sms]', e); }
      }
      // Email fallback (always works, no carrier filtering)
      if (client.email) {
        try {
          await sendEmail(env, {
            to: client.email,
            subject: `🚨 URGENT call missed at ${businessName}`,
            html: `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;"><div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px 20px;border-radius:8px;margin-bottom:20px;"><div style="color:#991b1b;font-weight:700;font-size:18px;margin-bottom:4px;">🚨 Urgent call recorded</div><div style="color:#7f1d1d;">An urgent caller just hung up at ${escapeHtml(businessName)}.</div></div><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:6px 0;color:#64748b;width:120px;">Caller phone:</td><td><a href="tel:${escapeHtml(callerNumber || '')}">${escapeHtml(callerNumber || 'Not captured')}</a></td></tr><tr><td style="padding:6px 0;color:#64748b;">Language:</td><td>${langLabel}</td></tr><tr><td style="padding:6px 0;color:#64748b;">Summary:</td><td>${escapeHtml(summarySnippet)}</td></tr></table><p style="color:#475569;line-height:1.6;margin-top:16px;">Please call this person back as soon as possible.</p></div>`,
          });
          await logUsage(env, client.id, 'urgent_email_sent');
        } catch (e) { console.error('[urgent email]', e); }
      }
    }

    // Auto-extract appointment from structured data if Vapi parsed one
    const structured = msg.structuredData || msg.analysis?.structuredData;
    if (structured?.appointmentBooked || structured?.patient_name) {
      const apptId = newId('appt');
      const apptAt = structured.appointmentDate ? new Date(structured.appointmentDate).getTime() : (Date.now() + 86400000);
      await env.DB.prepare(
        `INSERT INTO appointments (id, client_id, call_log_id, patient_name, patient_phone, service, appointment_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(apptId, client.id, id, structured.patient_name || 'Unknown', structured.patient_phone || callerNumber, structured.service || '', apptAt, 'booked', Date.now()).run();
      await logUsage(env, client.id, 'appointment_booked');

      // Send appointment SMS to practice (respects notify_appointment toggle)
      if (client.escalation_phone && (client.notify_appointment === 1 || client.notify_appointment === null)) {
        const apptDate = new Date(apptAt);
        const dateStr = apptDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const apptBody = `New appointment booked at ${client.business_name || 'your practice'}\nPatient: ${structured.patient_name || 'Unknown'}\nPhone: ${structured.patient_phone || callerNumber || 'unknown'}\nService: ${structured.service || 'general'}\nWhen: ${dateStr}`;
        try {
          const r = await sendSMS(env, { to: client.escalation_phone, body: apptBody });
          if (r.ok) await logUsage(env, client.id, 'appointment_sms_sent', { sid: r.sid });
        } catch (e) { console.error('[appt sms]', e); }
      }

      try {
        await pushAppointmentToAll(env, client.id, {
          patient_name: structured.patient_name || 'Unknown',
          patient_phone: structured.patient_phone || callerNumber,
          patient_email: structured.patient_email || null,
          service: structured.service || '',
          appointment_at: apptAt,
          notes: summary || '',
        });
      } catch (e) { console.error('[integrations push]', e); }
    }

    // Clean up silence state for this call so the table doesn't grow.
    try {
      const callIdForCleanup = msg.call?.id || msg.callId;
      if (callIdForCleanup) {
        await env.DB.prepare('UPDATE call_silence_state SET hung_up = 1 WHERE call_id = ?').bind(callIdForCleanup).run();
        // Best effort delete after a short delay so any in-flight idle timer can read state.
        await env.DB.prepare('DELETE FROM call_silence_state WHERE call_id = ?').bind(callIdForCleanup).run();
      }
    } catch (e) { /* ignore */ }

    return json({ ok: true, call_logged: true });
  }

  // ---- TRANSCRIPT (role: user) ----
  // Vapi only sends 'speech-update' for the AI's own voice activity, not for
  // the user. The user's speech is tracked via transcript events. So when a
  // user transcript arrives, we mark user_speaking and cancel any pending idle.
  if (type === 'transcript' && msg.role === 'user') {
    const callId = msg.call?.id;
    if (!callId) return json({ ok: true });
    const utterance = msg.transcript || msg.transcriptText || '';
    // Comprehensive Spanish detection — handles code-switched Spanglish like
    // "Para hacer un appointment" by checking for any Spanish-distinct word.
    const spanishRe = /[áéíóúñ¿¡]|\b(?:hola|gracias|por\s+favor|s[ií]|cita|dolor|sangrado|quiero|quisiera|necesito|para|hacer|qu[eé]|c[oó]mo|cu[aá]l|cu[aá]ndo|cu[aá]nto|d[oó]nde|qui[eé]n|hablar|espa[nñ]ol|ayuda|disculpe|perd[oó]n|llamar|tel[eé]fono|n[uú]mero|hoy|ma[nñ]ana|tarde|noche|d[ií]a|urgente|cuesta|tengo|estoy|est[aá]|soy|somos|esta|este|muy|mucho|tambi[eé]n|pero|sin|con|aqu[ií]|all[ií]|gracias|de\s+nada|adi[oó]s|cu[ií]dese|usted|ustedes|nosotros|me|le|los|las|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|dentista|doctora|m[eé]dico|emergencia|sangre|muela|diente)\b/i;
    const lang = spanishRe.test(utterance) ? 'es' : 'en';
    const controlUrl = msg.call?.monitor?.controlUrl || null;
    try {
      // Sticky language detection: only update lang on conflict if the new
      // utterance has clear Spanish signal AND current is 'en' (allows
      // 'en' -> 'es' flip when Spanish becomes obvious). NEVER flip 'es' -> 'en'
      // mid-call — names like 'Chucky' or digit utterances shouldn't reset language.
      await env.DB.prepare(
        `INSERT INTO call_silence_state (call_id, client_id, last_user_speech_at, lang, idle_count, user_speaking, control_url, check_in_progress)
         VALUES (?, ?, ?, ?, 0, 1, ?, 0)
         ON CONFLICT(call_id) DO UPDATE SET
           last_user_speech_at = excluded.last_user_speech_at,
           user_speaking = 1,
           control_url = COALESCE(excluded.control_url, call_silence_state.control_url),
           check_in_progress = 0,
           lang = CASE
             WHEN call_silence_state.lang = 'es' THEN 'es'
             WHEN excluded.lang = 'es' THEN 'es'
             ELSE call_silence_state.lang
           END`
      ).bind(callId, client.id, Date.now(), lang, controlUrl).run();
    } catch (e) { console.error('[transcript-state]', e); }
    return json({ ok: true });
  }

  // ---- SPEECH-UPDATE: AI just stopped talking, schedule silence check ----
  // We only care about role:assistant status:stopped — that's when the AI has
  // finished its turn and the user should respond. If the user doesn't speak
  // (no user transcript arrives) within idleTimeoutSeconds, fire idle prompt.
  if (type === 'speech-update' && msg.role === 'assistant' && msg.status === 'stopped') {
    const callId = msg.call?.id;
    if (!callId) return json({ ok: true });
    // Log call structure to find the right control endpoint
    try {
      await env.DB.prepare("INSERT INTO usage_events (client_id, event_type, event_data_json, created_at) VALUES (?, ?, ?, ?)")
        .bind(client.id, 'silence_diag', JSON.stringify({ event: 'call_object_keys', callId, keys: Object.keys(msg.call || {}), call: msg.call }), Date.now()).run();
    } catch {}
    // Mark user_speaking=0 so the silence check can run. Use existing lang or
    // default to en (we may not know language yet on first AI turn).
    const controlUrl = msg.call?.monitor?.controlUrl || null;
    try {
      // ONLY update existing rows. Do NOT create a row here — user transcript
      // is the only event that should establish the call's language. If user
      // hasn't spoken yet, no idle should fire (we don't know their language).
      await env.DB.prepare(
        `UPDATE call_silence_state SET user_speaking = 0, control_url = COALESCE(?, control_url) WHERE call_id = ?`
      ).bind(controlUrl, callId).run();
    } catch (e) { console.error('[ai-stopped-state]', e); }
    // Debounce: only spawn a silence-check timer if we have user data and no
    // check is already in flight. Without this, multiple AI pauses spawn parallel
    // timers that fire duplicate prompts.
    let stateCheck;
    try {
      stateCheck = await env.DB.prepare('SELECT lang, check_in_progress FROM call_silence_state WHERE call_id = ?').bind(callId).first();
    } catch (e) { stateCheck = null; }
    if (stateCheck && stateCheck.lang && !stateCheck.check_in_progress) {
      try {
        await env.DB.prepare('UPDATE call_silence_state SET check_in_progress = 1 WHERE call_id = ?').bind(callId).run();
      } catch {}
      const silencePromise = ensureSilenceCheck(env, callId, client, msg.assistant?.id || msg.call?.assistantId);
      if (context.waitUntil) context.waitUntil(silencePromise);
    }
    return json({ ok: true });
  }

  // ---- FUNCTION CALLS DURING CALL ----
  if (type === 'function-call' || type === 'tool-calls') {
    const fcs = msg.toolCallList || msg.toolCalls || [msg.functionCall];
    const responses = [];
    for (const fc of fcs.filter(Boolean)) {
      const name = fc.name || fc.function?.name;
      const params = fc.parameters || fc.function?.arguments || {};
      const args = typeof params === 'string' ? JSON.parse(params) : params;

      if (name === 'bookAppointment') {
        // Comprehensive phone parsing — handles any natural format
        const digits = parsePhoneNumber(args.patientPhone);
        const validPhone = digits !== null;
        const validName = (args.patientName || '').trim().length >= 2;
        if (!validPhone || !validName) {
          await logUsage(env, client.id, 'appointment_rejected_bad_data', { reason: !validPhone ? 'invalid_phone' : 'invalid_name', got_phone: rawPhone, got_name: args.patientName });
          responses.push({
            toolCallId: fc.id,
            result: !validPhone
              ? `I need a complete 10-digit US phone number passed as digits only (got: "${args.patientPhone || 'empty'}", parsed to ${digits.length} digits). Ask the caller to repeat their phone number and pass the result as digits like "7863177581" — not as Spanish/English words and not duplicated.`
              : "I need a full first and last name (first + last) before booking. Please ask the caller for their full name."
          });
          continue;
        }
        const apptId = newId('appt');
        const apptAt = args.requestedDateTime ? new Date(args.requestedDateTime).getTime() : (Date.now() + 86400000);
        await env.DB.prepare(
          `INSERT INTO appointments (id, client_id, patient_name, patient_phone, service, appointment_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(apptId, client.id, args.patientName.trim(), '+1' + digits.slice(-10), args.appointmentType || '', apptAt, 'booked', Date.now()).run();
        await logUsage(env, client.id, 'appointment_booked', { name: args.patientName });

        if (client.notify_appointment === 1 || client.notify_appointment === null) {
          const apptDate = new Date(apptAt);
          const dateStr = apptDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: client.timezone || 'America/New_York' });
          const businessName = client.business_name || 'your practice';
          // SMS (may be blocked by US A2P)
          if (client.escalation_phone) {
            const apptBody = `New appointment at ${businessName}\n${args.patientName || 'Unknown'} — ${args.appointmentType || 'general'}\nPhone: ${args.patientPhone || 'unknown'}\nWhen: ${dateStr}`;
            try {
              const r = await sendSMS(env, { to: client.escalation_phone, body: apptBody });
              if (r.ok) await logUsage(env, client.id, 'appointment_sms_sent', { sid: r.sid });
            } catch (e) { console.error('[appt sms]', e); }
          }
          // Email — always-deliverable fallback
          if (client.email) {
            try {
              await sendEmail(env, {
                to: client.email,
                subject: `📅 New appointment booked: ${args.patientName || 'patient'} — ${dateStr}`,
                html: `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;"><h2 style="color:#0a1628;">New appointment at ${escapeHtml(businessName)}</h2><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:6px 0;color:#64748b;width:120px;">Patient:</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(args.patientName || 'Unknown')}</td></tr><tr><td style="padding:6px 0;color:#64748b;">Phone:</td><td style="padding:6px 0;"><a href="tel:${escapeHtml(args.patientPhone || '')}">${escapeHtml(args.patientPhone || 'Unknown')}</a></td></tr><tr><td style="padding:6px 0;color:#64748b;">Service:</td><td style="padding:6px 0;">${escapeHtml(args.appointmentType || 'general')}</td></tr><tr><td style="padding:6px 0;color:#64748b;">When:</td><td style="padding:6px 0;font-weight:600;color:#0f172a;">${escapeHtml(dateStr)}</td></tr></table><p style="color:#475569;line-height:1.6;margin-top:16px;">Booked automatically by your AI receptionist. View in your dashboard.</p></div>`,
              });
              await logUsage(env, client.id, 'appointment_email_sent');
            } catch (e) { console.error('[appt email]', e); }
          }
        }

        try {
          await pushAppointmentToAll(env, client.id, {
            patient_name: args.patientName || 'Unknown',
            patient_phone: args.patientPhone || '',
            patient_email: args.patientEmail || null,
            service: args.appointmentType || '',
            appointment_at: apptAt,
            notes: args.notes || '',
          });
        } catch (e) { console.error('[integrations push]', e); }
        responses.push({ toolCallId: fc.id, result: 'Appointment booked successfully.' });
      } else if (name === 'sendUrgentAlert') {
        // Multi-channel urgent alert + AUTOMATIC appointment row creation.
        // The AI used to be able to verbally confirm an "appointment" without us actually
        // booking one. Fix: when the AI calls sendUrgentAlert with name + phone, we
        // ALWAYS insert an appointments row (status='urgent') so the office sees it
        // in their dashboard regardless of whether the AI also calls bookAppointment.
        await logUsage(env, client.id, 'urgent_escalation', args);
        let smsOk = false, emailOk = false, apptCreated = false, apptId = null;
        const reason = args.reason || args.summary || 'Urgent caller on the line';
        const callerNumber = args.callerNumber || args.patientPhone || '';
        const callerName = args.patientName || '';
        const businessName = client.business_name || 'your practice';

        // Comprehensive phone parsing — handles any natural format
        const digits = parsePhoneNumber(args.patientPhone || args.callerNumber);
        const validPhone = digits !== null;
        const validName = (callerName || '').trim().length >= 2;

        // ---- Insert appointment row (status='urgent') if we have name + phone ----
        if (validPhone && validName) {
          apptId = newId('appt');
          // Default: ASAP (now). If AI passed a requestedDateTime, use that.
          const apptAt = args.requestedDateTime ? new Date(args.requestedDateTime).getTime() : Date.now();
          try {
            await env.DB.prepare(
              `INSERT INTO appointments (id, client_id, patient_name, patient_phone, service, appointment_at, status, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(apptId, client.id, callerName.trim(), '+1' + digits, args.appointmentType || 'URGENT — ' + reason, apptAt, 'urgent', reason, Date.now()).run();
            await logUsage(env, client.id, 'appointment_booked', { name: callerName, urgent: true });
            apptCreated = true;

            // Push to integrations (Google Calendar / NexHealth / Calendly) so the practice's
            // existing scheduling system also has it.
            try {
              await pushAppointmentToAll(env, client.id, {
                patient_name: callerName.trim(),
                patient_phone: '+1' + digits,
                patient_email: args.patientEmail || null,
                service: args.appointmentType || ('URGENT — ' + reason),
                appointment_at: apptAt,
                notes: 'URGENT: ' + reason,
              });
            } catch (e) { console.error('[urgent integrations push]', e); }
          } catch (e) {
            console.error('[urgent appt insert]', e);
            await logUsage(env, client.id, 'urgent_appt_insert_failed', { err: String(e) });
          }
        }

        if (client.notify_urgent === 1 || client.notify_urgent === null) {
          // Try SMS via Twilio
          if (client.escalation_phone) {
            const urgentBody = `URGENT — caller on the line at ${businessName}\nFrom: ${callerNumber || ('+1' + digits) || 'unknown'}\nName: ${callerName || 'unknown'}\nReason: ${reason}\n\nCall back immediately.`;
            try {
              const r = await sendSMS(env, { to: client.escalation_phone, body: urgentBody });
              if (r.ok) { await logUsage(env, client.id, 'urgent_sms_sent', { sid: r.sid }); smsOk = true; }
              else { await logUsage(env, client.id, 'urgent_sms_failed', { reason: r.reason }); }
            } catch (e) { console.error('[urgent sms]', e); }
          }
          // Always also send email — never blocked by carriers, always delivered
          if (client.email) {
            try {
              const e = await sendEmail(env, {
                to: client.email,
                subject: `🚨 URGENT call from ${callerName || callerNumber || 'a patient'} — ${businessName}`,
                html: `
                  <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
                    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px 20px;border-radius:8px;margin-bottom:20px;">
                      <div style="color:#991b1b;font-weight:700;font-size:18px;margin-bottom:4px;">🚨 Urgent Call Alert</div>
                      <div style="color:#7f1d1d;">A caller is reporting an emergency at ${escapeHtml(businessName)}.</div>
                    </div>
                    <table style="width:100%;border-collapse:collapse;">
                      <tr><td style="padding:8px 0;color:#64748b;width:130px;">Caller name:</td><td style="padding:8px 0;font-weight:600;color:#0f172a;">${escapeHtml(callerName || 'Not provided')}</td></tr>
                      <tr><td style="padding:8px 0;color:#64748b;">Caller phone:</td><td style="padding:8px 0;font-weight:600;color:#0f172a;"><a href="tel:${escapeHtml(callerNumber || ('+1' + digits))}">${escapeHtml(callerNumber || ('+1' + digits) || 'Not provided')}</a></td></tr>
                      <tr><td style="padding:8px 0;color:#64748b;">Reason:</td><td style="padding:8px 0;color:#0f172a;">${escapeHtml(reason)}</td></tr>
                      <tr><td style="padding:8px 0;color:#64748b;">Time:</td><td style="padding:8px 0;color:#0f172a;">${new Date().toLocaleString('en-US',{timeZone: client.timezone || 'America/New_York'})}</td></tr>
                      ${apptCreated ? `<tr><td style="padding:8px 0;color:#64748b;">Booked:</td><td style="padding:8px 0;color:#16a34a;font-weight:600;">Yes — appt id ${apptId}</td></tr>` : ''}
                    </table>
                    <p style="color:#475569;line-height:1.6;margin-top:20px;">Call this person back as soon as possible. The AI told them you would.</p>
                    <p style="color:#94a3b8;font-size:13px;">This alert was triggered automatically by your AI receptionist when it detected an emergency.</p>
                  </div>
                `,
              });
              if (e?.ok || e?.id) { await logUsage(env, client.id, 'urgent_email_sent'); emailOk = true; }
              else { await logUsage(env, client.id, 'urgent_email_failed', e); }
            } catch (e) { console.error('[urgent email]', e); }
          }
        }

        const anySent = smsOk || emailOk;
        // Format the booked time for the AI's confirmation line. Use America/New_York
        // since most clients are East Coast; client-specific tz overrides if set.
        let timeStrEN = '', timeStrES = '';
        if (apptCreated && apptId) {
          const tz = client.timezone || 'America/New_York';
          const apptDate = new Date(args.requestedDateTime ? new Date(args.requestedDateTime).getTime() : Date.now());
          try {
            timeStrEN = apptDate.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', timeZone: tz });
            timeStrES = apptDate.toLocaleString('es-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', timeZone: tz });
          } catch { timeStrEN = 'the time we just confirmed'; timeStrES = 'la hora que confirmamos'; }
        }
        const successMsg = anySent
          ? `URGENT_ALERT_SENT. Appointment is BOOKED in the dashboard for the time the caller agreed to. Speak ONE language only matching the call language. The caller needs to hear (a) confirmation their appointment is set, (b) that the office is also being notified, (c) a warm closing.

If call was in ENGLISH say exactly: "Perfect — I have you down for ${timeStrEN || 'the time we just confirmed'} as an urgent visit, and I've notified the office so they're expecting you. If anything changes they'll call you right back. Take care, and we'll see you soon."

If call was in SPANISH say exactly: "Perfecto — lo tengo apuntado para ${timeStrES || 'la hora que confirmamos'} como cita urgente, y ya notifiqué a la oficina para que lo estén esperando. Si algo cambia, lo llaman de regreso. Cuídese mucho, lo esperamos."

Pick ONE language. Do NOT say both. Then end the call. Do NOT call bookAppointment — the urgent appointment is already saved.`
          : `URGENT_NOTED. Notification channels are NOT configured for this practice — but the appointment IS saved in the dashboard. Speak ONE language only matching the call language.

ENGLISH: "I have you down for ${timeStrEN || 'the time we agreed on'} as an urgent visit. The office will see this and call you back to confirm. Take care."

SPANISH: "Lo tengo apuntado para ${timeStrES || 'la hora que acordamos'} como cita urgente. La oficina lo va a ver y lo llamarán para confirmar. Cuídese."

Pick ONE. Do NOT say both. Then end the call.`;
        responses.push({ toolCallId: fc.id, result: successMsg });
      } else {
        responses.push({ toolCallId: fc.id, result: 'OK' });
      }
    }
    return json({ results: responses });
  }

  return json({ ok: true, ignored_type: type });
}
