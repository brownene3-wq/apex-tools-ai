import { json, requireAuth } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context);
  if (err) return err;
  return json({ user: context.data.user });
}
