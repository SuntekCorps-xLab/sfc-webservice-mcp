import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CREDENTIALS_FILE = path.join(os.homedir(), '.sfc', 'credentials.json');
/** Legacy skill path: KEY=VALUE lines (e.g. SFC_APP_KEY=...) */
const LEGACY_ENV_CREDENTIALS_FILE = path.join(os.homedir(), '.config', 'sfc', 'credentials');

/**
 * @typedef {{
 *   appKey: string,
 *   token: string,
 *   userId: string,
 *   divisionId?: string,
 * }} SfcCredentials
 */

/**
 * @returns {string}
 */
export function credentialsFilePath() {
  return process.env.SFC_CREDENTIALS_FILE || DEFAULT_CREDENTIALS_FILE;
}

/**
 * Parse KEY=VALUE credential file used by sfc-webservice-skill.
 * @param {string} file
 * @returns {Partial<SfcCredentials>}
 */
function parseEnvStyleCredentials(file) {
  if (!fs.existsSync(file)) {
    return {};
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return {
    appKey: map.SFC_APP_KEY || map.appKey || '',
    token: map.SFC_TOKEN || map.token || '',
    userId: map.SFC_USER_ID || map.userId || '',
    divisionId: map.SFC_DIVISION_ID || map.divisionId || '',
  };
}

/**
 * @returns {Partial<SfcCredentials>}
 */
function readCredentialsFile() {
  const file = credentialsFilePath();
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const trimmed = raw.trim();
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(raw);
        return {
          appKey: parsed.appKey || parsed.SFC_APP_KEY || '',
          token: parsed.token || parsed.SFC_TOKEN || '',
          userId: parsed.userId || parsed.SFC_USER_ID || '',
          divisionId: parsed.divisionId || parsed.SFC_DIVISION_ID || '',
        };
      }
      // Allow KEY=VALUE in the primary path too
      return parseEnvStyleCredentials(file);
    } catch {
      throw new Error(
        `Cannot read credentials file at ${file}. Fix JSON or remove the file.`,
      );
    }
  }
  // Fallback: skill-era local secret file
  return parseEnvStyleCredentials(LEGACY_ENV_CREDENTIALS_FILE);
}

/**
 * Env vars win over the credentials file.
 * @returns {SfcCredentials}
 */
export function loadCredentials() {
  const fileCreds = readCredentialsFile();
  const appKey = (process.env.SFC_APP_KEY || fileCreds.appKey || '').trim();
  const token = (process.env.SFC_TOKEN || fileCreds.token || '').trim();
  const userId = (process.env.SFC_USER_ID || fileCreds.userId || '').trim();
  const divisionId = (
    process.env.SFC_DIVISION_ID ||
    fileCreds.divisionId ||
    ''
  ).trim();

  if (!appKey || !token || !userId) {
    const missing = [
      !appKey && 'SFC_APP_KEY / appKey',
      !token && 'SFC_TOKEN / token',
      !userId && 'SFC_USER_ID / userId',
    ].filter(Boolean);
    throw new Error(
      `Missing SFC credentials: ${missing.join(', ')}. ` +
        `Set them in the MCP server env, or run sfc_setup to write ${credentialsFilePath()}, ` +
        `or place KEY=VALUE secrets at ${LEGACY_ENV_CREDENTIALS_FILE}. ` +
        `Ask your SFC account manager for API credentials.`,
    );
  }

  return { appKey, token, userId, divisionId: divisionId || undefined };
}

/**
 * @returns {{ appKey: string, token: string, userId: string }}
 */
export function headerRequest() {
  const c = loadCredentials();
  return { appKey: c.appKey, token: c.token, userId: c.userId };
}

/**
 * @param {string | number | undefined} override
 * @returns {string}
 */
export function resolveDivisionId(override) {
  if (override !== undefined && override !== null && String(override).trim() !== '') {
    return String(override).trim();
  }
  const c = loadCredentials();
  if (c.divisionId) {
    return c.divisionId;
  }
  return '1';
}

/**
 * @param {SfcCredentials} creds
 */
export function saveCredentials(creds) {
  const file = credentialsFilePath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  /** @type {Record<string, string>} */
  const payload = {
    appKey: creds.appKey.trim(),
    token: creds.token.trim(),
    userId: creds.userId.trim(),
  };
  if (creds.divisionId) {
    payload.divisionId = String(creds.divisionId).trim();
  }

  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
  return file;
}

/**
 * @returns {boolean}
 */
export function hasCredentials() {
  try {
    loadCredentials();
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{
 *   httpApiBase: string,
 *   soapWsdl: string,
 *   trackApi: string,
 *   labelBase: string,
 *   allowDelete: boolean,
 * }}
 */
export function loadRuntimeConfig() {
  return {
    httpApiBase:
      process.env.SFC_HTTP_API_BASE ||
      'https://www.sfcservice.com/ishipsvc/http-api',
    soapWsdl:
      process.env.SFC_SOAP_WSDL ||
      'https://www.sfcservice.com/ishipsvc/web-service?wsdl',
    trackApi:
      process.env.SFC_TRACK_API ||
      'https://tracking.sfcservice.com/tracking/track-api/get-track',
    labelBase:
      process.env.SFC_LABEL_BASE ||
      'https://www.sfcservice.com/order/print/index/',
    allowDelete: String(process.env.SFC_ALLOW_DELETE ?? 'true').toLowerCase() !== 'false',
  };
}

export const DIVISION_HINTS = [
  { id: '1', zh: '深圳分公司', en: 'Shenzhen' },
  { id: '2', zh: '广州分公司', en: 'Guangzhou' },
  { id: '14', zh: '上海分公司', en: 'Shanghai' },
  { id: '17', zh: '海外销售组', en: 'Huizhou Warehouse' },
  { id: '30', zh: 'FBA', en: 'FBA' },
  { id: '31', zh: '义乌分公司', en: 'Yiwu' },
  { id: '34', zh: '杭州分公司', en: 'Hangzhou' },
  { id: '37', zh: '义乌仓储', en: 'Yiwu Warehouse' },
];
