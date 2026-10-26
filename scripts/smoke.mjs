#!/usr/bin/env node
/**
 * Local smoke test against real SFC APIs using ~/.config/sfc/credentials
 * (or env / ~/.sfc/credentials.json). Does not create or delete orders.
 */
import { loadCredentials } from '../src/config.js';
import { callHttpApiAuto } from '../src/client/http.js';
import { httpThenSoap } from '../src/client/soap.js';
import { getTrack } from '../src/client/track.js';

const creds = loadCredentials();
const divisionId = creds.divisionId || '1';

console.log(
  JSON.stringify(
    {
      step: 'credentials',
      userId: creds.userId,
      divisionId,
      appKeyLen: creds.appKey.length,
      tokenLen: creds.token.length,
    },
    null,
    2,
  ),
);

const types = await callHttpApiAuto('getShiptypesByCountry', {
  getShiptypesByCountryRequestInfo: {
    country: 'US',
    weight: '0.5',
    length: '10',
    width: '10',
    height: '10',
    divisionId,
  },
});
const typeList = Array.isArray(types.data) ? types.data : [];
const sampleCode = typeList[0]?.shiptypecode || typeList[0]?.method_code;
console.log(
  JSON.stringify(
    {
      step: 'list_ship_types',
      ok: types.ok,
      count: typeList.length,
      sampleCode,
    },
    null,
    2,
  ),
);

const ratesByShip = sampleCode
  ? await callHttpApiAuto('getRatesByShip', {
      ratesRequestInfo: {
        shiptypescode: [sampleCode],
        scanType: '1',
        country: 'US',
        weight: '0.5',
        length: '10',
        width: '10',
        height: '10',
        priceType: '',
        divisionId,
        worth: '10',
        zip_code: '10001',
        state: 'NY',
        city: 'New York',
      },
    })
  : null;

console.log(
  JSON.stringify(
    {
      step: 'get_rates_by_ship',
      ok: ratesByShip?.ok ?? false,
      code: sampleCode,
      summary: summarizeRatePayload(ratesByShip?.data),
    },
    null,
    2,
  ),
);

const ratesAll = await httpThenSoap(
  'getRates',
  {
    ratesRequestInfo: {
      weight: '0.5',
      state: 'NY',
      country: 'US',
      length: '10',
      width: '10',
      height: '10',
      scanType: '1',
      priceType: '',
      divisionId,
      zipCode: '10001',
      city: 'New York',
    },
  },
  {
    ratesRequestInfo: {
      weight: '0.5',
      state: 'NY',
      country: 'US',
      length: '10',
      width: '10',
      height: '10',
      scanType: '1',
      priceType: '',
      divisionId,
      zipCode: '10001',
      city: 'New York',
    },
  },
  callHttpApiAuto,
);

const allRates = extractRates(ratesAll.data);
console.log(
  JSON.stringify(
    {
      step: 'get_rates',
      transport: ratesAll.transport,
      ok: ratesAll.ok,
      rateCount: allRates.length,
      cheapest: allRates
        .map((r) => ({
          code: r.shiptypecode,
          fee: r.totalfee,
          name: r.shiptypecnname || r.shiptypename,
        }))
        .sort((a, b) => Number(a.fee) - Number(b.fee))
        .slice(0, 5),
    },
    null,
    2,
  ),
);

// Tracking smoke with a fake number should still return structured JSON
const track = await getTrack(['INVALIDSMOKETEST001']);
console.log(
  JSON.stringify(
    {
      step: 'get_track',
      ok: track.ok,
      status: track.status,
      code: track.data?.code,
    },
    null,
    2,
  ),
);

console.log('\nSmoke finished. No orders created.');

/** @param {unknown} data */
function extractRates(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (Array.isArray(o.rates)) return o.rates;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

/** @param {unknown} data */
function summarizeRatePayload(data) {
  if (!data || typeof data !== 'object') return data;
  const o = /** @type {Record<string, unknown>} */ (data);
  if (Array.isArray(o.data)) {
    return o.data.slice(0, 3).map((row) => ({
      code: row.shiptypecode,
      totalfee: row.totalfee,
      currency: row.currency,
    }));
  }
  return { keys: Object.keys(o).slice(0, 10) };
}
