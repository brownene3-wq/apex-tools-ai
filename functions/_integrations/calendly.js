// Calendly integration: PAT + send self-booking SMS link via Twilio
const API_BASE = 'https://api.calendly.com';

export const verifyConnection = async ({ pat }) => {
  const r = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) throw new Error(`Calendly verification failed: ${r.status} ${await r.text()}`);
  return r.json();
};

export const listEventTypes = async ({ pat, user_uri }) => {
  const r = await fetch(`${API_BASE}/event_types?user=${encodeURIComponent(user_uri)}&active=true`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!r.ok) throw new Error(`Calendly event types fetch failed: ${r.status}`);
  const d = await r.json();
  return (d.collection || []).map(e => ({
    uri: e.uri, name: e.name, duration: e.duration, scheduling_url: e.scheduling_url, slug: e.slug,
  }));
};

export const pushAppointment = async (env, creds, config, appointment) => {
  const schedulingUrl = config.scheduling_url || creds.scheduling_url;
  if (!schedulingUrl) throw new Error('Calendly: no scheduling_url configured');
  const phone = appointment.patient_phone;
  if (!phone) return { external_id: null, note: 'no_phone_to_text' };
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    const message = `Hi ${appointment.patient_name || ''}, please pick a time that works: ${schedulingUrl}`.trim();
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`,
        From: env.TWILIO_FROM_NUMBER,
        Body: message,
      }),
    });
    if (!r.ok) throw new Error(`Calendly SMS push failed: ${r.status} ${await r.text()}`);
    const d = await r.json();
    return { external_id: d.sid, note: 'sms_sent' };
  }
  return { external_id: null, note: 'twilio_not_configured' };
};
