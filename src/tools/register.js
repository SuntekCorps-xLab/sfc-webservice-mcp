import { z } from 'zod';
import {
  DIVISION_HINTS,
  credentialsFilePath,
  hasCredentials,
  loadCredentials,
  loadRuntimeConfig,
  resolveDivisionId,
  saveCredentials,
} from '../config.js';
import { callHttpApiAuto } from '../client/http.js';
import { httpThenSoap } from '../client/soap.js';
import { getTrack } from '../client/track.js';
import { safeJson } from '../redact.js';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerTools(server) {
  const { allowDelete, labelBase } = loadRuntimeConfig();

  server.tool(
    'sfc_setup',
    'Save SFC API credentials to a private local file (~/.sfc/credentials.json). Prefer MCP env vars when possible. Never put credentials in chat after setup.',
    {
      appKey: z.string().min(1).describe('SFC-issued appKey'),
      token: z.string().min(1).describe('SFC-issued token'),
      userId: z.string().min(1).describe('SFC customer user code (userId)'),
      divisionId: z
        .string()
        .optional()
        .describe('Default division / warehouse id, e.g. 1 or 17'),
    },
    async ({ appKey, token, userId, divisionId }) => {
      const file = saveCredentials({ appKey, token, userId, divisionId });
      return text(
        `Credentials saved to ${file} (mode 600). ` +
          `userId=${userId.slice(0, 2)}*** divisionId=${divisionId || '(unset)'}. ` +
          `Do not repeat secrets in chat. Next: call sfc_verify_credentials.`,
      );
    },
  );

  server.tool(
    'sfc_credential_status',
    'Check whether SFC credentials are configured (does not print secrets).',
    {},
    async () => {
      const ok = hasCredentials();
      let divisionId;
      try {
        divisionId = loadCredentials().divisionId;
      } catch {
        divisionId = undefined;
      }
      return text(
        safeJson({
          configured: ok,
          credentialsFile: credentialsFilePath(),
          envOverrides: {
            SFC_APP_KEY: Boolean(process.env.SFC_APP_KEY),
            SFC_TOKEN: Boolean(process.env.SFC_TOKEN),
            SFC_USER_ID: Boolean(process.env.SFC_USER_ID),
            SFC_DIVISION_ID: Boolean(process.env.SFC_DIVISION_ID),
          },
          divisionId: divisionId || null,
          allowDelete,
          divisionHints: DIVISION_HINTS,
        }),
      );
    },
  );

  server.tool(
    'sfc_verify_credentials',
    'Read-only check: probe ship types for US with a small parcel. Tries division 1 then 17 unless divisionId is set.',
    {
      divisionId: z.string().optional().describe('Force a division id; otherwise auto-discover'),
      country: z.string().default('US').describe('ISO country code for probe'),
    },
    async ({ divisionId, country }) => {
      const candidates = divisionId
        ? [String(divisionId)]
        : [resolveDivisionId(undefined), '1', '17'].filter(
            (v, i, a) => a.indexOf(v) === i,
          );

      /** @type {Array<Record<string, unknown>>} */
      const attempts = [];
      for (const id of candidates) {
        const res = await callHttpApiAuto('getShiptypesByCountry', {
          getShiptypesByCountryRequestInfo: {
            country,
            weight: '0.5',
            length: '10',
            width: '10',
            height: '10',
            divisionId: id,
          },
        });
        const list = normalizeList(res.data);
        const usable = res.ok && list.length > 0;
        attempts.push({
          divisionId: id,
          httpOk: res.ok,
          methodCount: list.length,
          sample: list.slice(0, 3).map(summarizeShipType),
        });
        if (usable) {
          return text(
            safeJson({
              success: true,
              activeDivisionId: id,
              methodCount: list.length,
              hint: 'Save this divisionId via sfc_setup or SFC_DIVISION_ID for later calls.',
              sampleMethods: list.slice(0, 8).map(summarizeShipType),
            }),
          );
        }
      }
      return text(
        safeJson({
          success: false,
          message:
            'No usable ship-type list. Confirm credentials and division with SFC support.',
          attempts,
        }),
      );
    },
  );

  server.tool(
    'sfc_list_ship_types',
    'List shipping methods available for a destination country and parcel size (HTTPS getShiptypesByCountry).',
    {
      country: z.string().min(2).describe('Destination country code, e.g. US, GB, DE'),
      weightKg: z.union([z.string(), z.number()]).optional(),
      lengthCm: z.union([z.string(), z.number()]).optional(),
      widthCm: z.union([z.string(), z.number()]).optional(),
      heightCm: z.union([z.string(), z.number()]).optional(),
      divisionId: z.string().optional(),
    },
    async (args) => {
      const divisionId = resolveDivisionId(args.divisionId);
      const res = await callHttpApiAuto('getShiptypesByCountry', {
        getShiptypesByCountryRequestInfo: {
          country: args.country,
          weight: str(args.weightKg, '0.5'),
          length: str(args.lengthCm, '10'),
          width: str(args.widthCm, '10'),
          height: str(args.heightCm, '10'),
          divisionId,
        },
      });
      const list = normalizeList(res.data).map(summarizeShipType);
      return text(
        safeJson({
          ok: res.ok,
          divisionId,
          count: list.length,
          methods: list,
        }),
      );
    },
  );

  server.tool(
    'sfc_get_rates',
    'Quote rates. If shipTypeCodes is set, uses HTTPS getRatesByShip; otherwise SOAP/HTTPS getRates for all methods.',
    {
      country: z.string().min(2),
      weightKg: z.union([z.string(), z.number()]),
      lengthCm: z.union([z.string(), z.number()]),
      widthCm: z.union([z.string(), z.number()]),
      heightCm: z.union([z.string(), z.number()]),
      state: z.string().optional().describe('State / province; defaults to country'),
      city: z.string().optional(),
      zipCode: z.string().optional(),
      worth: z.union([z.string(), z.number()]).optional().describe('Declared value for getRatesByShip'),
      shipTypeCodes: z
        .array(z.string())
        .optional()
        .describe('Optional list of SFC shipping method codes'),
      divisionId: z.string().optional(),
      priceType: z.string().optional().describe('1=customer discount price, 2=list price'),
    },
    async (args) => {
      const divisionId = resolveDivisionId(args.divisionId);
      const weight = str(args.weightKg);
      const length = str(args.lengthCm);
      const width = str(args.widthCm);
      const height = str(args.heightCm);
      const state = args.state || args.country;
      const zip = args.zipCode || '';

      if (args.shipTypeCodes && args.shipTypeCodes.length > 0) {
        const res = await callHttpApiAuto('getRatesByShip', {
          ratesRequestInfo: {
            shiptypescode: args.shipTypeCodes,
            scanType: '1',
            country: args.country,
            weight,
            length,
            width,
            height,
            priceType: args.priceType || '',
            divisionId,
            worth: str(args.worth, '1'),
            zip_code: zip,
            state,
            city: args.city || '',
          },
        });
        return text(safeJson({ transport: 'https', api: 'getRatesByShip', divisionId, result: res.data }));
      }

      const ratesRequestInfo = {
        weight,
        state,
        country: args.country,
        length,
        width,
        height,
        scanType: '1',
        priceType: args.priceType || '',
        divisionId,
        zipCode: zip,
        city: args.city || '',
      };
      const res = await httpThenSoap(
        'getRates',
        { ratesRequestInfo },
        { ratesRequestInfo },
        callHttpApiAuto,
      );
      return text(
        safeJson({
          transport: res.transport,
          api: 'getRates',
          divisionId,
          rates: summarizeRates(res.data),
          raw: res.data,
        }),
      );
    },
  );

  server.tool(
    'sfc_preview_order',
    'Build and validate an addOrder payload locally. Does NOT submit. Call sfc_create_order with confirm=true after customer approval.',
    orderInputSchema(),
    async (args) => {
      const payload = buildAddOrderPayload(args);
      const missing = validateOrderPayload(payload.addOrderRequestInfo);
      return text(
        safeJson({
          willSubmit: false,
          ready: missing.length === 0,
          missingFields: missing,
          preview: redactOrderPreview(payload.addOrderRequestInfo),
          nextStep:
            missing.length === 0
              ? 'Ask the customer to confirm, then call sfc_create_order with the same fields and confirm=true.'
              : 'Ask the customer for the missing fields, then preview again.',
        }),
      );
    },
  );

  server.tool(
    'sfc_create_order',
    'Create an SFC order (addOrder). Requires confirm=true. Prefer sfc_preview_order first. Do not retry on timeout — search the customer order number instead.',
    {
      ...orderInputSchema(),
      confirm: z
        .boolean()
        .describe('Must be true to submit. False or omitted = dry-run only.'),
    },
    async (args) => {
      const payload = buildAddOrderPayload(args);
      const missing = validateOrderPayload(payload.addOrderRequestInfo);
      if (missing.length > 0) {
        return text(
          safeJson({
            submitted: false,
            error: 'Missing required fields',
            missingFields: missing,
          }),
        );
      }
      if (!args.confirm) {
        return text(
          safeJson({
            submitted: false,
            message: 'confirm=false: dry-run only. Set confirm=true after customer approval.',
            preview: redactOrderPreview(payload.addOrderRequestInfo),
          }),
        );
      }

      const res = await httpThenSoap(
        'addOrder',
        { addOrderRequestInfo: payload.addOrderRequestInfo },
        { addOrderRequestInfo: payload.addOrderRequestInfo },
        callHttpApiAuto,
      );

      return text(
        safeJson({
          submitted: true,
          transport: res.transport,
          result: res.data,
          reminder:
            'Creating an order does not charge until SFC receives and processes the parcel. Keep orderCode / trackingNumber for labels.',
        }),
      );
    },
  );

  server.tool(
    'sfc_search_order',
    'Look up an order by SFC orderCode (searchOrder).',
    {
      orderCode: z.string().min(1).describe('SFC order code'),
    },
    async ({ orderCode }) => {
      const info = { orderCode };
      const res = await httpThenSoap(
        'searchOrder',
        { searchOrderRequestInfo: info },
        { searchOrderRequestInfo: info },
        callHttpApiAuto,
      );
      return text(safeJson({ transport: res.transport, result: res.data }));
    },
  );

  server.tool(
    'sfc_get_fee',
    'Get fee by SFC order code (getFeeByOrderCode).',
    {
      orderCode: z.string().min(1),
    },
    async ({ orderCode }) => {
      const res = await httpThenSoap(
        'getFeeByOrderCode',
        { orderCode },
        { orderCode },
        callHttpApiAuto,
      );
      return text(safeJson({ transport: res.transport, result: res.data }));
    },
  );

  server.tool(
    'sfc_get_label_url',
    'Build a label PDF URL for a confirmed SFC orderCode. Does not call print if you only need the link.',
    {
      orderCode: z.string().min(1),
      printType: z.string().default('1'),
      printSize: z.string().default('1').describe('1 = common 10x15cm; confirm with SFC if unsure'),
      isPrintDeclare: z.string().optional(),
    },
    async ({ orderCode, printType, printSize, isPrintDeclare }) => {
      const url = new URL(labelBase);
      url.searchParams.set('orderCodeList', orderCode);
      url.searchParams.set('printType', printType);
      url.searchParams.set('print_type', 'pdf');
      url.searchParams.set('printSize', printSize);
      if (isPrintDeclare != null) {
        url.searchParams.set('isPrintDeclare', isPrintDeclare);
      }
      return text(
        safeJson({
          labelUrl: url.toString(),
          note: 'Open the URL to download PDF. Never put credentials in this URL. If not a PDF, ask SFC about account print settings.',
        }),
      );
    },
  );

  server.tool(
    'sfc_get_track',
    'Track shipments by tracking number(s). Uses tracking.sfcservice.com (up to 40 numbers).',
    {
      numbers: z.array(z.string()).min(1).max(40),
      client: z.string().optional().describe('Optional client/platform tag'),
    },
    async ({ numbers, client }) => {
      const res = await getTrack(numbers, client || 'sfc-mcp');
      return text(safeJson({ ok: res.ok, result: res.data }));
    },
  );

  if (allowDelete) {
    server.tool(
      'sfc_delete_order',
      'Delete an SFC order by orderCode. Requires confirm=true. Prefer searching the order first.',
      {
        orderCode: z.string().min(1),
        confirm: z.boolean().describe('Must be true to delete'),
      },
      async ({ orderCode, confirm }) => {
        if (!confirm) {
          return text(
            safeJson({
              deleted: false,
              message: 'confirm=false: no delete performed. Set confirm=true to proceed.',
              orderCode,
            }),
          );
        }
        const del = { orderCode };
        const res = await httpThenSoap(
          'deleteOrder',
          { delOrderRequestInfo: del },
          { delOrderRequestInfo: del },
          callHttpApiAuto,
        );
        return text(
          safeJson({
            deleted: true,
            transport: res.transport,
            orderCode,
            result: res.data,
          }),
        );
      },
    );
  }
}

/** @returns {Record<string, z.ZodTypeAny>} */
function orderInputSchema() {
  return {
    customerOrderNo: z.string().optional().describe('Customer reference / unique order code'),
    divisionId: z.string().optional().describe('opDivision; defaults to configured division'),
    orderStatus: z
      .enum(['confirmed', 'preprocess'])
      .default('confirmed')
      .describe('confirmed or preprocess'),
    shippingMethod: z.string().min(1).describe('SFC shipping method code from list/rates'),
    recipientName: z.string().min(1),
    recipientCountry: z.string().min(2),
    recipientAddress: z.string().min(1),
    recipientState: z.string().optional(),
    recipientCity: z.string().optional(),
    recipientZipCode: z.string().optional(),
    recipientPhone: z.string().optional(),
    recipientEmail: z.string().optional(),
    recipientOrganization: z.string().optional(),
    goodsDescription: z.string().min(1).describe('Order / parcel description'),
    goodsDeclareWorth: z.union([z.string(), z.number()]).describe('Total declared value'),
    worthCurrency: z.string().optional().default('USD'),
    goodsWeight: z.union([z.string(), z.number()]).optional(),
    goodsLength: z.union([z.string(), z.number()]).optional(),
    goodsWidth: z.union([z.string(), z.number()]).optional(),
    goodsHeight: z.union([z.string(), z.number()]).optional(),
    pieceNumber: z.union([z.string(), z.number()]).optional(),
    withBattery: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
    goodsDetails: z
      .array(
        z.object({
          detailDescription: z.string().min(1),
          detailDescriptionCN: z.string().optional(),
          detailQuantity: z.union([z.string(), z.number()]),
          detailWorth: z.union([z.string(), z.number()]),
          detailCustomLabel: z.string().optional(),
          hsCode: z.string().optional(),
          detailWeight: z.union([z.string(), z.number()]).optional(),
          origin: z.string().optional(),
          enMaterial: z.string().optional(),
          cnMaterial: z.string().optional(),
        }),
      )
      .min(1),
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildAddOrderPayload(args) {
  const opDivision = Number(resolveDivisionId(args.divisionId));
  const withBattery =
    args.withBattery === true || args.withBattery === 1
      ? 1
      : args.withBattery === false || args.withBattery === 0
        ? 0
        : undefined;

  /** @type {Record<string, unknown>} */
  const addOrderRequestInfo = {
    customerOrderNo: args.customerOrderNo,
    opDivision,
    orderStatus: args.orderStatus || 'confirmed',
    recipientName: args.recipientName,
    recipientCountry: args.recipientCountry,
    shippingMethod: args.shippingMethod,
    recipientState: args.recipientState,
    recipientCity: args.recipientCity,
    recipientAddress: args.recipientAddress,
    recipientZipCode: args.recipientZipCode,
    recipientPhone: args.recipientPhone,
    recipientEmail: args.recipientEmail,
    recipientOrganization: args.recipientOrganization,
    goodsDeclareWorth: str(args.goodsDeclareWorth),
    worthCurrency: args.worthCurrency || 'USD',
    goodsWeight: args.goodsWeight != null ? str(args.goodsWeight) : undefined,
    goodsLength: args.goodsLength != null ? str(args.goodsLength) : undefined,
    goodsWidth: args.goodsWidth != null ? str(args.goodsWidth) : undefined,
    goodsHeight: args.goodsHeight != null ? str(args.goodsHeight) : undefined,
    pieceNumber: args.pieceNumber != null ? Number(args.pieceNumber) : undefined,
    goodsDescription: args.goodsDescription,
    shipperAddressType: 1,
    withBattery,
    erp_source: 'sfc-webservice-mcp',
    goodsDetails: (args.goodsDetails || []).map((g) => ({
      detailDescription: g.detailDescription,
      detailDescriptionCN: g.detailDescriptionCN,
      detailQuantity: str(g.detailQuantity),
      detailWorth: str(g.detailWorth),
      detailCustomLabel: g.detailCustomLabel,
      hsCode: g.hsCode,
      detailWeight: g.detailWeight != null ? str(g.detailWeight) : undefined,
      origin: g.origin || 'CN',
      enMaterial: g.enMaterial,
      cnMaterial: g.cnMaterial,
    })),
  };

  // Drop undefined keys
  pruneUndefined(addOrderRequestInfo);
  for (const row of /** @type {Record<string, unknown>[]} */ (addOrderRequestInfo.goodsDetails)) {
    pruneUndefined(row);
  }

  return { addOrderRequestInfo };
}

/**
 * @param {Record<string, unknown>} info
 */
function validateOrderPayload(info) {
  const required = [
    'opDivision',
    'orderStatus',
    'recipientName',
    'recipientCountry',
    'shippingMethod',
    'recipientAddress',
    'goodsDeclareWorth',
    'goodsDescription',
    'shipperAddressType',
    'goodsDetails',
  ];
  /** @type {string[]} */
  const missing = [];
  for (const key of required) {
    const v = info[key];
    if (v === undefined || v === null || v === '') missing.push(key);
  }
  if (!Array.isArray(info.goodsDetails) || info.goodsDetails.length === 0) {
    if (!missing.includes('goodsDetails')) missing.push('goodsDetails');
  }
  return missing;
}

/**
 * @param {Record<string, unknown>} info
 */
function redactOrderPreview(info) {
  return {
    customerOrderNo: info.customerOrderNo,
    opDivision: info.opDivision,
    orderStatus: info.orderStatus,
    shippingMethod: info.shippingMethod,
    recipient: {
      name: info.recipientName,
      country: info.recipientCountry,
      state: info.recipientState,
      city: info.recipientCity,
      zip: info.recipientZipCode,
      address: maskMiddle(String(info.recipientAddress || '')),
      phone: info.recipientPhone ? maskMiddle(String(info.recipientPhone)) : undefined,
    },
    parcel: {
      weightKg: info.goodsWeight,
      lengthCm: info.goodsLength,
      widthCm: info.goodsWidth,
      heightCm: info.goodsHeight,
      declareWorth: info.goodsDeclareWorth,
      currency: info.worthCurrency,
      description: info.goodsDescription,
      withBattery: info.withBattery,
      itemCount: Array.isArray(info.goodsDetails) ? info.goodsDetails.length : 0,
    },
  };
}

/** @param {string} s */
function maskMiddle(s) {
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

/** @param {Record<string, unknown>} obj */
function pruneUndefined(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
}

/** @param {unknown} data */
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.rates)) return o.rates;
  }
  return [];
}

/** @param {any} row */
function summarizeShipType(row) {
  return {
    code: row.shiptypecode || row.method_code || row.code,
    nameZh: row.shiptypecnname || row.cn_name,
    nameEn: row.shiptypename || row.en_name,
    deliveryTime: row.deliverytime,
    tracking: row.iftracking,
    battery: row.isbattery,
    volumetric: row.isweight,
  };
}

/** @param {unknown} data */
function summarizeRates(data) {
  const list = normalizeList(data);
  if (list.length === 0 && data && typeof data === 'object' && 'rates' in /** @type {object} */ (data)) {
    return normalizeList(/** @type {any} */ (data).rates).map(summarizeRateRow);
  }
  return list.map(summarizeRateRow);
}

/** @param {any} row */
function summarizeRateRow(row) {
  return {
    code: row.shiptypecode,
    nameZh: row.shiptypecnname,
    nameEn: row.shiptypename,
    totalFee: row.totalfee,
    currency: row.currency || 'RMB',
    deliveryTime: row.deliverytime,
    tracking: row.iftracking,
    battery: row.isbattery,
  };
}

/**
 * @param {unknown} v
 * @param {string} [fallback]
 */
function str(v, fallback) {
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    return '';
  }
  return String(v);
}

/** @param {string} body */
function text(body) {
  return { content: [{ type: 'text', text: body }] };
}
