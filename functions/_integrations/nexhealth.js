// NexHealth integration: API key + practice subdomain.
// Covers Dentrix, Open Dental, Eaglesoft, Carestack, Curve via NexHealth's unified API.
const API_BASE = 'https://nexhealth.info';

const getBearerToken = async (apiKey) => {
  const r = await fetch(`${API_BASE}/authenticates`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': apiKey },
  });
  if (!r.ok) throw new Error(`NexHealth auth failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d?.data?.token;
};

export const verifyConnection = async ({ api_key, subdomain }) => {
  const token = await getBearerToken(api_key);
  const r = await fetch(`${API_BASE}/locations?subdomain=${encodeURIComponent(subdomain)}`, {
    headers: { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`NexHealth verification failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  const locations = d?.data || [];
  if (!locations.length) throw new Error('No locations returned for this subdomain');
  return { ok: true, locations };
};

export const pushAppointment = async (env, creds, config, appointment) => {
  const { api_key, subdomain } = creds;
  const { location_id, provider_id, operatory_id } = config;
  if (!location_id || !provider_id) throw new Error('NexHealth missing location_id or provider_id');
  const token = await getBearerToken(api_key);
  const phone = (appointment.patient_phone || '').replace(/\D/g, '');
  let patientId = null;
  if (phone) {
    const search = await fetch(
      `${API_BASE}/patients?subdomain=${encodeURIComponent(subdomain)}&location_id=${location_id}&phone_number=${phone}`,
      { headers: { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': `Bearer ${token}` } }
    );
    if (search.ok) { const sd = await search.json(); patientId = sd?.data?.patients?.[0]?.id || null; }
  }
  if (!patientId) {
    const [first, ...rest] = (appointment.patient_name || 'Unknown Patient').split(/\s+/);
    const last = rest.join(' ') || '-';
    const create = await fetch(
      `${API_BASE}/patients?subdomain=${encodeURIComponent(subdomain)}&location_id=${location_id}`,
      {
        method: 'POST',
        headers: { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: { provider_id },
          patient: {
            first_name: first || 'Unknown',
            last_name: last,
            email: appointment.patient_email || undefined,
            bio: { phone_number: phone || undefined },
          },
        }),
      }
    );
    if (!create.ok) throw new Error(`NexHealth patient create failed: ${create.status} ${await create.text()}`);
    const cd = await create.json();
    patientId = cd?.data?.user?.id || cd?.data?.id;
    if (!patientId) throw new Error('NexHealth patient create returned no id');
  }
  const start = new Date(appointment.appointment_at).toISOString();
  const r = await fetch(
    `${API_BASE}/appointments?subdomain=${encodeURIComponent(subdomain)}&location_id=${location_id}&notify_patient=false`,
    {
      method: 'POST',
      headers: { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appt: {
          patient_id: patientId,
          provider_id,
          operatory_id: operatory_id || undefined,
          start_time: start,
          end_time: new Date(new Date(start).getTime() + 30 * 60000).toISOString(),
          note: `Booked by Apex Tools AI receptionist. Service: ${appointment.service || 'general'}.`,
        },
      }),
    }
  );
  if (!r.ok) throw new Error(`NexHealth appointment create failed: ${r.status} ${await r.text()}`);
  const ad = await r.json();
  return { external_id: ad?.data?.appt?.id || ad?.data?.id || null };
};

export const listResources = async ({ api_key, subdomain }) => {
  const token = await getBearerToken(api_key);
  const headers = { 'Accept': 'application/vnd.Nexhealth+json;version=2', 'Authorization': `Bearer ${token}` };
  const [locResp, provResp] = await Promise.all([
    fetch(`${API_BASE}/locations?subdomain=${encodeURIComponent(subdomain)}`, { headers }),
    fetch(`${API_BASE}/providers?subdomain=${encodeURIComponent(subdomain)}&include[]=operatories`, { headers }),
  ]);
  const loc = locResp.ok ? await locResp.json() : { data: [] };
  const prov = provResp.ok ? await provResp.json() : { data: [] };
  return {
    locations: (loc.data || []).map(l => ({ id: l.id, name: l.name, address: l.address || '' })),
    providers: (prov.data || []).map(p => ({
      id: p.id,
      name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      operatories: (p.operatories || []).map(o => ({ id: o.id, name: o.name })),
    })),
  };
};
