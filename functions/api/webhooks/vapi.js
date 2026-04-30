// POST /api/webhooks/vapi — Vapi posts end-of-call reports + function calls here.
// Maps the Vapi assistant ID to our client_id, then inserts call_logs / appointments.
// Configure Vapi assistant Server URL = https://apextoolsai.com/api/webhooks/vapi
import { json, newId, logUsage, sendSMS, sendEmail, escapeHtml } from '../../_lib.js';
import { pushAppointmentToAll } from '../../_integrations.js';
import { ensureAssistantSynced } from '../../_vapi.js';

// Send the AI a language-matched check-in via Vapi's say API after a delay.
// This replaces Vapi's static idleMessages so the prompt language matches
// the call language (which Vapi can't do natively).
async function ensureSilenceCheck(env, callId, client, assistantId) {
  // Fire-and-forget background timer. Cloudflare Pages Functions run in
  // workerd which keeps the request alive while there are pending promises.
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const idleTimeoutMs = 8000;
  const maxIdle = 2;

  for (let i = 0; i < maxIdle; i++) {
    await wait(idleTimeoutMs);

    // Re-read state — if user spoke since, abort.
    let state;
    try {
      state = await env.DB.prepare(
        'SELECT last_user_speech_at, lang, idle_count, user_speaking, hung_up FROM call_silence_state WHERE call_id = ?'
      ).bind(callId).first();
    } catch (e) { return; }
    if (!state) return;
    if (state.hung_up) return;
    if (state.user_speaking) return; // user came back
    if (state.idle_count >= maxIdle) return;

    // Still silent — send say request to Vapi
    const lang = state.lang || 'en';
    const prompts = [
      lang === 'es' ? '¿Hola? ¿Sigue ahí?' : 'Hello? Are you still there?',
      lang === 'es' ? 'Tómese su tiempo, lo escucho.' : "Take your time, I am here whenever you're ready.",
    ];
    const message = prompts[state.idle_count] || prompts[0];

    try {
      const r = await fetch(`https://api.vapi.ai/call/${callId}/control`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.VAPI_ORG_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'say', message, endCallAfterSpoken: false }),
      });
      if (r.ok) {
        await env.DB.prepare(
          'UPDATE call_silence_state SET idle_count = idle_count + 1 WHERE call_id = ?'
        ).bind(callId).run();
      }
    } catch (e) { console.error('[say-api]', e); }
  }
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
  // arriving at this webhook. (We had silent failures because speech-update
  // events weren't being delivered.) This gets cleaned up once silence handler
  // is confirmed working.
  try {
    await logUsage(env, client.id, 'vapi_webhook_event', { type, callId: msg.call?.id, role: msg.role, status: msg.status });
  } catch (e) { /* ignore */ }

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

  // ---- SPEECH-UPDATE: track silence and fire language-aware idle prompts ----
  // Vapi's static idleMessages don't know the call's locked language. We
  // disable those (set to []) and handle silence here with a custom timer:
  // when the user stops talking, schedule a delayed check; if still silent,
  // send a 'still there?' prompt in the language matching the most recent
  // user utterance.
  if (type === 'speech-update') {
    const callId = msg.call?.id;
    const role = msg.role;        // 'user' | 'assistant'
    const status = msg.status;    // 'started' | 'stopped'
    if (!callId || role !== 'user') return json({ ok: true });

    if (status === 'started') {
      // User started speaking — clear any pending idle from server-side state.
      try {
        await env.DB.prepare(
          "UPDATE call_silence_state SET user_speaking = 1, last_user_speech_at = ? WHERE call_id = ?"
        ).bind(Date.now(), callId).run();
      } catch (e) { /* row may not exist yet */ }
      return json({ ok: true });
    }

    if (status === 'stopped') {
      // User stopped speaking — record state and schedule a silence check.
      const transcript = msg.artifact?.transcript || msg.transcript || '';
      const lastTurn = transcript.split('\n').filter(l => l.startsWith('User:')).slice(-1)[0] || '';
      const lang = /[áéíóúñ¿¡]|hola|gracias|por favor|sí|cita|dolor|sangrado/i.test(lastTurn) ? 'es' : 'en';

      try {
        await env.DB.prepare(
          `INSERT INTO call_silence_state (call_id, client_id, last_user_speech_at, lang, idle_count, user_speaking)
           VALUES (?, ?, ?, ?, 0, 0)
           ON CONFLICT(call_id) DO UPDATE SET last_user_speech_at = excluded.last_user_speech_at, lang = excluded.lang, user_speaking = 0`
        ).bind(callId, client.id, Date.now(), lang).run();
      } catch (e) { console.error('[silence-state-insert]', e); }

      // Schedule a silence check for 8s from now.
      const ctx = arguments[0]; // can't read here; use a simple background schedule
      // Cloudflare Workers / Pages support waitUntil via the parent context arg.
      // We can call it by capturing context above — implemented via ensureSilenceCheck below.
      const silencePromise = ensureSilenceCheck(env, callId, client, msg.assistant?.id || msg.call?.assistantId);
      if (context.waitUntil) context.waitUntil(silencePromise);
      return json({ ok: true });
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
        // Server-side data quality gate — reject bookings without a usable callback phone
        // Convert Spanish/English digit words to digits as a safety net in case the AI passes spoken words
        const wordToDigit = {
          'cero': '0', 'zero': '0', 'oh': '0',
          'uno': '1', 'una': '1', 'one': '1',
          'dos': '2', 'two': '2',
          'tres': '3', 'three': '3',
          'cuatro': '4', 'four': '4',
          'cinco': '5', 'five': '5',
          'seis': '6', 'six': '6',
          'siete': '7', 'seven': '7',
          'ocho': '8', 'eight': '8',
          'nueve': '9', 'nine': '9',
        };
        let rawPhone = String(args.patientPhone || '');
        // First, replace any digit-words with digits
        rawPhone = rawPhone.toLowerCase()
          .replace(/[áéíóúñ]/g, (c) => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ñ:'n'}[c] || c))
          .replace(/\b(cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)\b/g,
                   (m) => wordToDigit[m] || m);
        let digits = rawPhone.replace(/\D/g, '');
        // If we got more than 15 digits, the AI may have passed the number doubled — take the FIRST 10
        if (digits.length > 15 && digits.length % 10 === 0) {
          digits = digits.slice(0, 10);
        }
        // Strip leading 1 (US country code) if present and gives us exactly 11
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        const validPhone = digits.length === 10;
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

        // ---- Phone-digit normalization (same gate as bookAppointment) ----
        const wordToDigit = {
          'cero':'0','zero':'0','oh':'0',
          'uno':'1','una':'1','one':'1',
          'dos':'2','two':'2',
          'tres':'3','three':'3',
          'cuatro':'4','four':'4',
          'cinco':'5','five':'5',
          'seis':'6','six':'6',
          'siete':'7','seven':'7',
          'ocho':'8','eight':'8',
          'nueve':'9','nine':'9',
        };
        let rawPhone = String(args.patientPhone || args.callerNumber || '');
        rawPhone = rawPhone.toLowerCase()
          .replace(/[áéíóúñ]/g, (c) => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ñ:'n'}[c] || c))
          .replace(/\b(cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)\b/g,
                   (m) => wordToDigit[m] || m);
        let digits = rawPhone.replace(/\D/g, '');
        if (digits.length > 15 && digits.length % 10 === 0) digits = digits.slice(0, 10);
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        const validPhone = digits.length === 10;
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
