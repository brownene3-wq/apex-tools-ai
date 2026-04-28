// Integration dispatcher
import * as googleCalendar from './_integrations/google_calendar.js';
import * as nexhealth from './_integrations/nexhealth.js';
import * as calendly from './_integrations/calendly.js';

const PROVIDERS = { google_calendar: googleCalendar, nexhealth, calendly };
export const PROVIDER_LIST = ['google_calendar', 'nexhealth', 'calendly'];
export const getProvider = (name) => PROVIDERS[name];

export const listForClient = async (env, clientId) => {
  const rows = await env.DB.prepare(
    'SELECT provider, status, config_json, last_pushed_at, last_error, updated_at FROM client_integrations WHERE client_id = ?'
  ).bind(clientId).all();
  const byProvider = {};
  for (const r of (rows.results || [])) {
    let config = {};
    try { config = r.config_json ? JSON.parse(r.config_json) : {}; } catch {}
    byProvider[r.provider] = {
      status: r.status, config,
      last_pushed_at: r.last_pushed_at, last_error: r.last_error, updated_at: r.updated_at,
    };
  }
  return byProvider;
};

export const saveIntegration = async (env, clientId, provider, credentials, config = {}) => {
  const now = Date.now();
  const credsJson = JSON.stringify(credentials);
  const configJson = JSON.stringify(config);
  const existing = await env.DB.prepare(
    'SELECT id FROM client_integrations WHERE client_id = ? AND provider = ?'
  ).bind(clientId, provider).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE client_integrations SET credentials_json = ?, config_json = ?, status = 'connected', last_error = NULL, updated_at = ? WHERE id = ?"
    ).bind(credsJson, configJson, now, existing.id).run();
  } else {
    const id = `intg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      "INSERT INTO client_integrations (id, client_id, provider, status, credentials_json, config_json, created_at, updated_at) VALUES (?, ?, ?, 'connected', ?, ?, ?, ?)"
    ).bind(id, clientId, provider, credsJson, configJson, now, now).run();
  }
};

export const disconnectIntegration = async (env, clientId, provider) => {
  await env.DB.prepare('DELETE FROM client_integrations WHERE client_id = ? AND provider = ?').bind(clientId, provider).run();
};

export const pushAppointmentToAll = async (env, clientId, appointment) => {
  const rows = await env.DB.prepare(
    "SELECT id, provider, credentials_json, config_json FROM client_integrations WHERE client_id = ? AND status = 'connected'"
  ).bind(clientId).all();
  const results = [];
  for (const row of (rows.results || [])) {
    const provider = PROVIDERS[row.provider];
    if (!provider?.pushAppointment) continue;
    let creds = {}, config = {};
    try { creds = JSON.parse(row.credentials_json || '{}'); } catch {}
    try { config = JSON.parse(row.config_json || '{}'); } catch {}
    try {
      const out = await provider.pushAppointment(env, creds, config, appointment);
      if (out?.fresh_creds) {
        await env.DB.prepare(
          'UPDATE client_integrations SET credentials_json = ?, last_pushed_at = ?, last_error = NULL, updated_at = ? WHERE id = ?'
        ).bind(JSON.stringify(out.fresh_creds), Date.now(), Date.now(), row.id).run();
      } else {
        await env.DB.prepare(
          'UPDATE client_integrations SET last_pushed_at = ?, last_error = NULL, updated_at = ? WHERE id = ?'
        ).bind(Date.now(), Date.now(), row.id).run();
      }
      results.push({ provider: row.provider, ok: true, external_id: out?.external_id, note: out?.note });
    } catch (e) {
      const errMsg = String(e.message || e).slice(0, 500);
      await env.DB.prepare(
        "UPDATE client_integrations SET last_error = ?, status = 'error', updated_at = ? WHERE id = ?"
      ).bind(errMsg, Date.now(), row.id).run();
      console.error('[integration push]', row.provider, errMsg);
      results.push({ provider: row.provider, ok: false, error: errMsg });
    }
  }
  return results;
};
