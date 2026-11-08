// ai.js
// Sends a requirement typed into the AI box to the `fixture-ai` Supabase
// Edge Function (supabase/functions/fixture-ai), which asks Claude to turn
// it into structured rules. The AI key lives only in Supabase, never in
// this site's code.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const aiAvailable = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * @returns {Promise<{reply: string, add: object[], remove: string[]}>}
 */
export async function askRequirementsAI({ message, history, context, rules }) {
  if (!aiAvailable) throw new Error('The AI box needs the shared database connected.');
  let res;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/fixture-ai`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, history, context, rules }),
    });
  } catch {
    throw new Error("Couldn't reach the AI. Check the internet connection and try again.");
  }
  if (res.status === 404) throw new Error('The AI box isn’t switched on yet (its server function hasn’t been deployed).');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The AI returned an error (${res.status}).`);
  return { reply: data.reply || '', add: data.add || [], remove: data.remove || [] };
}
