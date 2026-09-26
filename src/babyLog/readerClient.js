// Thin client for the Python page-reader service (Railway internal network).
// Needs Node 18+ for global fetch, FormData, Blob.

export class ReaderError extends Error {}

export function createReaderClient({ url, key, timeoutMs = 60000 }) {
  if (!url) throw new Error('PAPER_READER_URL is not set');
  const headers = key ? { 'X-Reader-Key': key } : {};

  async function call(path, init) {
    const res = await fetch(url.replace(/\/$/, '') + path, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { detail: text }; }
    if (!res.ok) {
      const msg = typeof body.detail === 'string' ? body.detail : 'The page reader had a problem.';
      throw new ReaderError(msg);
    }
    return body;
  }

  return {
    readSpread(images) {
      const form = new FormData();
      images.forEach((buf, i) => form.append('images', new Blob([buf], { type: 'image/jpeg' }), `page${i + 1}.jpg`));
      return call('/v1/read-spread', { method: 'POST', body: form });
    },
    events(month, rows, tz = 'Asia/Singapore') {
      return call('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, tz, rows }),
      });
    },
  };
}
