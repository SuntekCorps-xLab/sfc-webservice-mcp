import { headerRequest, loadRuntimeConfig } from '../config.js';

/**
 * Call SFC legacy HTTPS API.
 * Prefer GET (verified for customer accounts); POST form as fallback.
 *
 * @param {string} apiName
 * @param {Record<string, unknown>} bodyFields fields besides HeaderRequest
 * @param {{ method?: 'GET' | 'POST' }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown, raw: string }>}
 */
export async function callHttpApi(apiName, bodyFields, opts = {}) {
  const { httpApiBase } = loadRuntimeConfig();
  const parameterObj = {
    HeaderRequest: headerRequest(),
    ...bodyFields,
  };
  const parameter = JSON.stringify(parameterObj);
  const method = opts.method || 'GET';

  let response;
  if (method === 'POST') {
    const form = new URLSearchParams();
    form.set('apiName', apiName);
    form.set('parameter', parameter);
    response = await fetch(httpApiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain, */*',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(60_000),
    });
  } else {
    const url = new URL(httpApiBase);
    url.searchParams.set('apiName', apiName);
    url.searchParams.set('parameter', parameter);
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(60_000),
    });
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { rawText: raw.slice(0, 4000) };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: raw.slice(0, 8000),
  };
}

/**
 * Try GET first; on auth-ish failure retry once with POST.
 * @param {string} apiName
 * @param {Record<string, unknown>} bodyFields
 */
export async function callHttpApiAuto(apiName, bodyFields) {
  const first = await callHttpApi(apiName, bodyFields, { method: 'GET' });
  if (first.ok && !looksLikeAuthFailure(first.data)) {
    return first;
  }
  const second = await callHttpApi(apiName, bodyFields, { method: 'POST' });
  if (second.ok || !first.ok) {
    return second;
  }
  return first;
}

/**
 * @param {unknown} data
 */
function looksLikeAuthFailure(data) {
  const text = JSON.stringify(data || {}).toLowerCase();
  return (
    text.includes('auth') ||
    text.includes('token') ||
    text.includes('appkey') ||
    text.includes('permission') ||
    text.includes('unauthorized') ||
    text.includes('凭证') ||
    text.includes('鉴权')
  );
}
