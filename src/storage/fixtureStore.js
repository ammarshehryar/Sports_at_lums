// fixtureStore.js
// Saves and reopens fixtures. Each fixture is one record:
//   { id, name, created_by, state, created_at, updated_at }
// where `state` is the whole dashboard (roster, venues, settings, the
// generated schedule and every result/edit since).
//
// Backed by Supabase when src/storage/config.js has a URL and key, and by
// this browser's localStorage otherwise, behind the same functions.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const usingCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// ---------- Supabase (REST) ----------

const base = () => `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/fixtures`;
const headers = (extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function call(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Database error ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res.status === 204 ? null : res.json();
}

const cloud = {
  list: () => call(`${base()}?select=id,name,created_by,created_at,updated_at&order=updated_at.desc`, { headers: headers() }),
  async getRev(id) {
    const rows = await call(`${base()}?id=eq.${encodeURIComponent(id)}&select=rev`, { headers: headers() });
    return rows?.[0]?.rev ?? null;
  },
  async load(id) {
    const rows = await call(`${base()}?id=eq.${encodeURIComponent(id)}&select=*`, { headers: headers() });
    return rows?.[0] || null;
  },
  async create(name, createdBy) {
    const rows = await call(base(), {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify({ name, created_by: createdBy, state: {} }),
    });
    return rows[0];
  },
  // Only succeeds if nobody else saved since `rev`; otherwise {conflict}.
  async save(id, state, rev) {
    const rows = await call(`${base()}?id=eq.${encodeURIComponent(id)}&rev=eq.${Number(rev) || 0}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify({ state, rev: (Number(rev) || 0) + 1, updated_at: new Date().toISOString() }),
    });
    return rows?.length ? { ok: true, rev: rows[0].rev } : { ok: false, conflict: true };
  },
  remove: (id) => call(`${base()}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() }),
};

// ---------- localStorage fallback ----------

const KEY = 'sal-fixtures-v1';
function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    throw new Error(`Could not save in this browser: ${e.message}`);
  }
}
const uid = () =>
  globalThis.crypto?.randomUUID?.() || `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const local = {
  async list() {
    return Object.values(readAll())
      .map(({ state: _s, ...meta }) => meta)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  },
  async load(id) {
    return readAll()[id] || null;
  },
  async create(name, createdBy) {
    const now = new Date().toISOString();
    const rec = { id: uid(), name, created_by: createdBy, state: {}, rev: 0, created_at: now, updated_at: now };
    const all = readAll();
    all[rec.id] = rec;
    writeAll(all);
    return rec;
  },
  async getRev(id) {
    return readAll()[id]?.rev ?? 0;
  },
  async save(id, state, rev) {
    const all = readAll();
    if (!all[id]) return { ok: false, conflict: false };
    const cur = all[id].rev ?? 0;
    if (cur !== (Number(rev) || 0)) return { ok: false, conflict: true };
    all[id] = { ...all[id], state, rev: cur + 1, updated_at: new Date().toISOString() };
    writeAll(all);
    return { ok: true, rev: cur + 1 };
  },
  async remove(id) {
    const all = readAll();
    delete all[id];
    writeAll(all);
  },
};

const store = usingCloud ? cloud : local;

export const listFixtures = () => store.list();
export const loadFixture = (id) => store.load(id);
export const createFixture = (name, createdBy) => store.create(name, createdBy);
export const saveFixture = (id, state, rev) => store.save(id, state, rev);
export const getFixtureRev = (id) => store.getRev(id);
export const deleteFixture = (id) => store.remove(id);
