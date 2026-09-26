// Telegram Mini App: dashboard page + two JSON endpoints.
// Framework-free. Works as Express middleware or bare http handler.
// Every API call carries Telegram initData, verified with HMAC-SHA256
// against the bot token. Only the linked caregiver can read their baby's log.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ageText, currentRowDateStr, addDays, dayLabel, hrs } from '../format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const HTML = readFileSync(join(__dirname, 'index.html'));
const MAX_AGE_S = 24 * 3600;

export function verifyInitData(initData, botToken, nowS = Math.floor(Date.now() / 1000)) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const want   = createHmac('sha256', secret).update(check).digest();
  const got    = Buffer.from(hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  if (nowS - Number(params.get('auth_date') || 0) > MAX_AGE_S) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) reject(new Error('too big')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function doctorSummary(baby, days, avg7) {
  const rows = days.filter((d) => d.source !== 'none');
  const head = 'Date        Sleep  Night  Longest  Feeds  W/D';
  const body = rows.map((d) => [
    dayLabel(d.row_date).padEnd(11),
    hrs(d.sleep_min).padStart(5),
    hrs(d.night_sleep_min).padStart(6),
    hrs(d.longest_stretch_min).padStart(8),
    String(d.feeds).padStart(6),
    `${d.wet ?? '-'}/${d.dirty ?? '-'}`.padStart(6),
  ].join(' '));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const age = ageText(baby.birth_date);
  return [
    `<b>${esc(baby.name)}${age ? `, ${age}` : ''}</b>`,
    `Log for the last ${days.length} days. Each day runs 7pm the evening before to 7pm, Singapore time.`,
    '',
    `<pre>${esc([head, ...body].join('\n'))}</pre>`,
    avg7?.days_with_data ? `7-day average: ${hrs(avg7.sleep_min)} sleep (longest stretch ${hrs(avg7.longest_stretch_min)}), ${avg7.feeds} feeds, ${avg7.wet} wet and ${avg7.dirty} dirty diapers a day.` : '',
    'Recorded by the parents in a paper notebook (30-minute squares) and quick taps.',
  ].join('\n');
}

export function createMiniAppHandler({ queries, botToken, bot, basePath = '' }) {
  if (!botToken) throw new Error('Mini App needs the bot token to verify users');

  async function dashboard(user) {
    const baby = await queries.babyFor(user.id);
    if (!baby) return { status: 404, body: { error: 'no_baby' } };
    const today = currentRowDateStr();
    const [status, days, avg3, avg7] = await Promise.all([
      queries.status(baby.id),
      queries.days(baby.id, addDays(today, -27), today),
      queries.averages(baby.id, 3),
      queries.averages(baby.id, 7),
    ]);
    return {
      status: 200,
      body: { baby: { name: baby.name, birth_date: baby.birth_date, age: ageText(baby.birth_date) }, status, days, avg3, avg7, today },
    };
  }

  return async function handler(req, res, next) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || '/' : null;
    try {
      if (p === null) return next ? next() : send(res, 404, { error: 'not_found' });
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, HTML, 'text/html; charset=utf-8');
      if (req.method !== 'POST' || !p.startsWith('/api/')) return next ? next() : send(res, 404, { error: 'not_found' });

      const body = await readJson(req);
      const user = verifyInitData(body.initData, botToken);
      if (!user) return send(res, 401, { error: 'unauthorised' });

      if (p === '/api/dashboard') {
        const out = await dashboard(user);
        return send(res, out.status, out.body);
      }
      if (p === '/api/doctor-summary') {
        const baby = await queries.babyFor(user.id);
        if (!baby) return send(res, 404, { error: 'no_baby' });
        const today = currentRowDateStr();
        const [days, avg7] = await Promise.all([
          queries.days(baby.id, addDays(today, -14), addDays(today, -1)),
          queries.averages(baby.id, 7),
        ]);
        await bot.telegram.sendMessage(user.id, doctorSummary(baby, days, avg7), { parse_mode: 'HTML' });
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not_found' });
    } catch (e) {
      console.error('mini app error', e);
      return send(res, 500, { error: 'server_error' });
    }
  };
}
