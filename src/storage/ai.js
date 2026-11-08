// ai.js
// Turns a requirement typed into the Requirements box into structured rules.
// By default this is the free built-in assistant (engine/requirementParser.js).
// If the optional `fixture-ai` Supabase Edge Function is ever deployed with
// an AI key, it is used instead; the key lives only in Supabase.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { parseRequirement } from '../engine/requirementParser.js';

export const aiAvailable = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * @returns {Promise<{reply: string, add: object[], remove: string[]}>}
 */
// Once the AI server function says it isn't set up, stop asking it this visit.
let aiOff = !aiAvailable;

export async function askRequirementsAI({ message, history, context, rules }) {
  let aiProblem = '';
  const builtIn = () => ({ ...parseRequirement(message, context, rules), source: 'built-in', aiProblem });
  if (aiOff) return builtIn();
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
    aiOff = true;
    aiProblem = 'the AI server could not be reached';
    return builtIn();
  }
  // Not deployed (404) or no key added (503): use the free built-in assistant.
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 503 || res.status === 401) {
    aiOff = true;
    aiProblem =
      res.status === 404
        ? 'the fixture-ai function is not deployed'
        : res.status === 503
          ? 'no AI key is saved in Supabase secrets'
          : 'the AI server refused the request';
    return builtIn();
  }
  if (!res.ok) {
    aiProblem = data.error || `AI error ${res.status}`;
    return builtIn();
  }
  return { reply: data.reply || '', add: data.add || [], remove: data.remove || [], source: 'ai' };
}
