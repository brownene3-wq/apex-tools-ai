// Google Calendar integration: OAuth + events.insert
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';

export const buildAuthUrl = (env, state) => {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_BASE_URL || 'https://apextoolsai.com'}/api/integrations/google/callback`,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

export const exchangeCode = async (env, code) => {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.PUBLIC_BASE_URL || 'https://apextoolsai.com'}/api/integrations/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
};

export const refreshToken = async (env, refresh_token) => {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Google token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
};

const ensureFreshToken = async (env, creds) => {
  if (creds.token_expires_at && creds.token_expires_at > Date.now() + 60000) return creds;
  const refreshed = await refreshToken(env, creds.refresh_token);
  return {
    ...creds,
    access_token: refreshed.access_token,
    token_expires_at: Date.now() + (refreshed.expires_in - 60) * 1000,
  };
};

export const getUserEmail = async (accessToken) => {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.email;
};

export const pushAppointment = async (env, creds, config, appointment) => {
  const fresh = await ensureFreshToken(env, creds);
  const calendarId = config.calendar_id || 'primary';
  const start = new Date(appointment.appointment_at);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const event = {
    summary: `${appointment.service || 'Appointment'} — ${appointment.patient_name}`,
    description: [
      'Booked by Apex Tools AI receptionist.',
      `Patient: ${appointment.patient_name}`,
      appointment.patient_phone ? `Phone: ${appointment.patient_phone}` : null,
      appointment.patient_email ? `Email: ${appointment.patient_email}` : null,
      appointment.service ? `Service: ${appointment.service}` : null,
      appointment.notes ? `Notes: ${appointment.notes}` : null,
    ].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', headers: { Authorization: `Bearer ${fresh.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
  );
  if (!r.ok) throw new Error(`Google Calendar push failed: ${r.status} ${await r.text()}`);
  const created = await r.json();
  return { external_id: created.id, fresh_creds: fresh };
};
