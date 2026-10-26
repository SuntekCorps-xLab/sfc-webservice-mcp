import { headerRequest, loadRuntimeConfig } from '../config.js';

/**
 * Minimal SOAP 1.1 document/literal client for SFC WSDL operations.
 * Avoids heavy soap SDK; builds a typed envelope with JSON-like nesting.
 *
 * @param {string} methodName e.g. addOrder
 * @param {Record<string, unknown>} args fields besides HeaderRequest
 * @returns {Promise<{ ok: boolean, data: unknown, raw: string }>}
 */
export async function callSoap(methodName, args) {
  const { soapWsdl } = loadRuntimeConfig();
  const endpoint = soapWsdl.replace(/\?wsdl$/i, '');
  const payload = {
    HeaderRequest: headerRequest(),
    ...args,
  };
  const bodyInner = objectToSoapXml(payload);
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ship="http://www.example.org/ShipRate/">
  <soapenv:Header/>
  <soapenv:Body>
    <ship:${escapeXmlName(methodName)}>
${bodyInner}
    </ship:${escapeXmlName(methodName)}>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `http://www.example.org/ShipRate/${methodName}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(90_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      data: { error: `SOAP HTTP ${response.status}`, snippet: raw.slice(0, 2000) },
      raw: raw.slice(0, 8000),
    };
  }

  if (raw.includes('soap:Fault') || raw.includes('soapenv:Fault') || raw.includes('Fault>')) {
    const fault = extractTag(raw, 'faultstring') || extractTag(raw, 'faultString') || 'SOAP Fault';
    return { ok: false, data: { error: fault, snippet: raw.slice(0, 2000) }, raw: raw.slice(0, 8000) };
  }

  // Prefer JSON-looking text nodes if present; else return simplified parse
  const returnXml = extractMethodReturn(raw, methodName);
  const parsed = tryParseSoapResult(returnXml || raw);
  return { ok: true, data: parsed, raw: raw.slice(0, 8000) };
}

/**
 * Prefer HTTPS; fall back to SOAP for write/search methods.
 * @param {string} apiName
 * @param {Record<string, unknown>} httpBody
 * @param {Record<string, unknown>} soapArgs
 * @param {(http: import('./http.js').callHttpApiAuto)} httpCaller
 */
export async function httpThenSoap(apiName, httpBody, soapArgs, httpCaller) {
  const http = await httpCaller(apiName, httpBody);
  if (http.ok && !isEmptyOrHardError(http.data)) {
    return { transport: 'https', ...http };
  }
  const soap = await callSoap(apiName, soapArgs);
  return { transport: 'soap', ok: soap.ok, status: soap.ok ? 200 : 500, data: soap.data, raw: soap.raw };
}

/**
 * @param {unknown} data
 */
function isEmptyOrHardError(data) {
  if (data == null) return true;
  if (typeof data === 'object') {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (o.ask === 'Error') return true;
    if (o.code === 500) return true;
    if (typeof o.msg === 'string' && /apiName|not exist|不存在/i.test(o.msg)) return true;
    if (typeof o.message === 'string' && /apiName|not exist|不存在/i.test(o.message)) return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {number} indent
 */
function objectToSoapXml(obj, indent = 6) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    const name = escapeXmlName(key);
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          lines.push(`${pad}<ship:${name}>`);
          lines.push(objectToSoapXml(/** @type {Record<string, unknown>} */ (item), indent + 2));
          lines.push(`${pad}</ship:${name}>`);
        } else {
          lines.push(`${pad}<ship:${name}>${escapeXml(String(item))}</ship:${name}>`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${pad}<ship:${name}>`);
      lines.push(objectToSoapXml(/** @type {Record<string, unknown>} */ (value), indent + 2));
      lines.push(`${pad}</ship:${name}>`);
    } else {
      lines.push(`${pad}<ship:${name}>${escapeXml(String(value))}</ship:${name}>`);
    }
  }
  return lines.join('\n');
}

/** @param {string} name */
function escapeXmlName(name) {
  return name.replace(/[^A-Za-z0-9_.:-]/g, '_');
}

/** @param {string} s */
function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** @param {string} xml @param {string} tag */
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** @param {string} xml @param {string} methodName */
function extractMethodReturn(xml, methodName) {
  const candidates = [
    `${methodName}Response`,
    `${methodName}Return`,
    'return',
  ];
  for (const tag of candidates) {
    const v = extractTag(xml, tag);
    if (v) return v;
  }
  return null;
}

/** @param {string} xmlOrText */
function tryParseSoapResult(xmlOrText) {
  const trimmed = xmlOrText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  // Flatten simple child tags into an object
  /** @type {Record<string, string>} */
  const flat = {};
  const re = /<([A-Za-z0-9_.:-]+)>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(trimmed)) !== null) {
    const key = m[1].includes(':') ? m[1].split(':').pop() : m[1];
    if (key) flat[key] = m[2];
  }
  if (Object.keys(flat).length > 0) {
    return flat;
  }
  return { xmlSnippet: trimmed.slice(0, 4000) };
}
