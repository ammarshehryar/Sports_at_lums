// Supabase Edge Function: fixture-ai
// Turns a plain-language scheduling requirement from the portal's AI box
// into structured rules (see src/engine/constraints.js for what each rule
// kind means). The AI never edits fixtures; the portal's scheduler applies
// the rules.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY  required (console.anthropic.com -> API keys)
//   ANTHROPIC_MODEL    optional, defaults to claude-sonnet-5-5
// Or, instead of Claude: GEMINI_API_KEY (+ optional GEMINI_MODEL).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['unavailable', 'onlyWindow', 'venueClosed', 'venueForSport', 'minRest', 'maxPerDay'],
    },
    target: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['delegation', 'team'] },
        name: { type: 'string' },
      },
      required: ['type', 'name'],
    },
    sport: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD; omit for every day' },
    from: { type: 'string', description: 'HH:MM 24h; omit for start of day' },
    to: { type: 'string', description: 'HH:MM 24h; omit for end of day' },
    venue: { type: 'string' },
    venues: { type: 'array', items: { type: 'string' } },
    minutes: { type: 'number' },
    max: { type: 'number' },
  },
  required: ['kind'],
};

const TOOL = {
  name: 'update_requirements',
  description: 'Record the scheduling requirements to add or remove, and reply to the organiser.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'One or two short, plain sentences to the organiser.' },
      add: { type: 'array', items: RULE_SCHEMA },
      remove: { type: 'array', items: { type: 'string' }, description: 'ids of existing rules to remove' },
    },
    required: ['reply', 'add', 'remove'],
  },
};

function systemPrompt(context: unknown, rules: unknown) {
  return `You help a university sports tournament organiser schedule fixtures. The organiser types requirements in plain language; you convert them into structured rules with the update_requirements tool. You never schedule matches yourself: the portal's scheduler moves fixtures to satisfy the rules.

Rule kinds:
- unavailable: target (a delegation or a team) cannot play during a window. Optional sport, date (YYYY-MM-DD, omit = every day), from/to (HH:MM 24h, omit both = whole day).
- onlyWindow: matches of target (or of a sport, if no target) may only be played inside the window.
- venueClosed: venue (required) unavailable during date/from/to.
- venueForSport: sport (required) may only use the listed venues (required).
- minRest: target (omit = everyone) needs at least "minutes" between their matches.
- maxPerDay: target (omit = everyone) plays at most "max" matches per day, optional sport.

Guidance:
- Match names to the context lists case-insensitively and use the exact spelling from the lists. A name in "delegations" is a delegation target; a name in teamsBySport is a team target. If it is in both, prefer delegation unless the organiser clearly means one team.
- Resolve day names and relative dates ("Saturday", "day 2", "tomorrow") to dates using venueDays and today. "Morning" means 09:00 to 12:00, "afternoon" 12:00 to 17:00, "evening" 17:00 onwards, unless the venue hours suggest otherwise.
- One message can produce several rules. To change an existing rule, remove it by id and add the new version. If the organiser asks to cancel or undo something, remove the matching rule ids.
- If a name, date or time is genuinely ambiguous or not in the lists, add nothing and ask one short question in reply.
- Replies are short, plain and friendly, with no dashes.

Tournament context:
${JSON.stringify(context)}

Rules already in force (with ids):
${JSON.stringify(rules)}`;
}

async function askClaude(key: string, system: string, messages: { role: string; content: string }[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5',
      max_tokens: 1500,
      system,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude API error ${res.status}`);
  const call = (data.content || []).find((c: { type: string }) => c.type === 'tool_use');
  if (!call) throw new Error('The AI did not return any rules.');
  return call.input;
}

async function askGemini(key: string, system: string, messages: { role: string; content: string }[]) {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `${system}\n\nRespond only with JSON matching this schema: ${JSON.stringify(TOOL.input_schema)}` }],
      },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { message, history = [], context = {}, rules = [] } = await req.json();
    if (!message || typeof message !== 'string') return json({ error: 'No message.' }, 400);
    if (message.length > 2000) return json({ error: 'Message too long.' }, 400);

    const messages = [
      ...history
        .filter((h: { role: string; text: string }) => h && (h.role === 'user' || h.role === 'ai') && h.text)
        .slice(-6)
        .map((h: { role: string; text: string }) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: String(h.text) })),
      { role: 'user', content: message },
    ];
    // The API needs alternating turns starting with the user.
    const merged: { role: string; content: string }[] = [];
    for (const m of messages) {
      if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += `\n${m.content}`;
      else merged.push({ ...m });
    }
    while (merged.length && merged[0].role !== 'user') merged.shift();

    const system = systemPrompt(context, rules);
    const anthropic = Deno.env.get('ANTHROPIC_API_KEY');
    const gemini = Deno.env.get('GEMINI_API_KEY');
    if (!anthropic && !gemini) return json({ error: 'The AI key hasn’t been added in Supabase yet.' }, 503);
    const out = anthropic ? await askClaude(anthropic, system, merged) : await askGemini(gemini!, system, merged);

    return json({
      reply: String(out?.reply || ''),
      add: Array.isArray(out?.add) ? out.add.filter((r: { kind?: string }) => r && r.kind) : [],
      remove: Array.isArray(out?.remove) ? out.remove.map(String) : [],
    });
  } catch (e) {
    return json({ error: (e as Error).message || 'AI request failed.' }, 500);
  }
});
