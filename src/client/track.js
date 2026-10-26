import { loadRuntimeConfig } from '../config.js';

/**
 * Tracking uses a separate host; no HeaderRequest on this endpoint.
 * @param {string[]} numbers
 * @param {string} [client]
 */
export async function getTrack(numbers, client = 'sfc-mcp') {
  const { trackApi } = loadRuntimeConfig();
  const unique = [...new Set(numbers.map((n) => String(n).trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('Provide at least one tracking / order number.');
  }
  if (unique.length > 40) {
    throw new Error('getTrack allows at most 40 numbers per request.');
  }

  const url = new URL(trackApi);
  url.searchParams.set('data', JSON.stringify(unique));
  url.searchParams.set('client', client);

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { rawText: raw.slice(0, 4000) };
  }
  return { ok: response.ok, status: response.status, data, raw: raw.slice(0, 8000) };
}
