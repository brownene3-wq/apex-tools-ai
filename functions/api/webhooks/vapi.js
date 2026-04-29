// POST /api/webhooks/vapi — Vapi posts end-of-call reports + function calls here.
// Maps the Vapi assistant ID to our client_id, then inserts call_logs / appointments.
// Configure Vapi assistant Server URL = https://apextoolsai.com/api/webhooks/vapi
import { json, newId, logUsage, sendSMS } from '../../_lib.js';
import { pushAppointmentToAll } from '../../_integrations.js';

export async function onRequestPost({ request, env }) {
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
    if (wasUrgent && client.escalation_phone && (client.notify_urgent === 1 || client.notify_urgent === null)) {
      const langLabel = language === 'es' ? 'Spanish' : 'English';
      const urgentBody = `URGENT call to ${client.business_name || 'your practice'}\nFrom: ${callerNumber || 'unknown'}\nLanguage: ${langLabel}\nSummary: ${(summary || transcript || '').substring(0, 220)}\n\nReply or call back ASAP.`;
      try {
        const smsRes = await sendSMS(env, { to: client.escalation_phone, body: urgentBody });
        if (smsRes.ok) await logUsage(env, client.id, 'urgent_sms_sent', { sid: smsRes.sid });
        else await logUsage(env, client.id, 'urgent_sms_failed', { reason: smsRes.reason });
      } catch (e) { console.error('[urgent sms]', e); }
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

    return json({ ok: true, call_logged: true });
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

        if (client.escalation_phone && (client.notify_appointment === 1 || client.notify_appointment === null)) {
          const apptDate = new Date(apptAt);
          const dateStr = apptDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const apptBody = `New appointment booked at ${client.business_name || 'your practice'}\nPatient: ${args.patientName || 'Unknown'}\nPhone: ${args.patientPhone || 'unknown'}\nService: ${args.appointmentType || 'general'}\nWhen: ${dateStr}`;
          try {
            const r = await sendSMS(env, { to: client.escalation_phone, body: apptBody });
            if (r.ok) await logUsage(env, client.id, 'appointment_sms_sent', { sid: r.sid });
          } catch (e) { console.error('[appt sms]', e); }
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
        // Real urgent SMS to the practice's escalation phone
        await logUsage(env, client.id, 'urgent_escalation', args);
        let smsResult = 'Office has been alerted.';
        if (client.escalation_phone && (client.notify_urgent === 1 || client.notify_urgent === null)) {
          const reason = args.reason || args.summary || 'Urgent caller on the line';
          const callerNumber = args.callerNumber || args.patientPhone || '';
          const urgentBody = `URGENT — caller on the line at ${client.business_name || 'your practice'}\nReason: ${reason}\nFrom: ${callerNumber || 'unknown'}\n\nCall back immediately.`;
          try {
            const r = await sendSMS(env, { to: client.escalation_phone, body: urgentBody });
            if (r.ok) {
              await logUsage(env, client.id, 'urgent_sms_sent', { sid: r.sid });
              smsResult = 'Office has been texted and alerted.';
            } else {
              await logUsage(env, client.id, 'urgent_sms_failed', { reason: r.reason });
            }
          } catch (e) { console.error('[urgent sms via fc]', e); }
        }
        responses.push({ toolCallId: fc.id, result: smsResult });
      } else {
        responses.push({ toolCallId: fc.id, result: 'OK' });
      }
    }
    return json({ results: responses });
  }

  return json({ ok: true, ignored_type: type });
}
