/**
 * Never echo credentials or full PII dumps in tool results.
 */

const SECRET_KEYS = new Set([
  'appkey',
  'token',
  'userid',
  'sfc_app_key',
  'sfc_token',
  'sfc_user_id',
  'password',
  'authenticate',
]);

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactDeep(value) {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * @param {unknown} data
 * @returns {string}
 */
export function safeJson(data) {
  return JSON.stringify(redactDeep(data), null, 2);
}
