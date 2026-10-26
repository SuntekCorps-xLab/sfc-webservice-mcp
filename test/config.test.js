import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { redactDeep } from '../src/redact.js';

test('redactDeep hides credential keys', () => {
  const out = redactDeep({
    HeaderRequest: { appKey: 'secret', token: 't', userId: 'u1' },
    orderCode: 'ABC',
  });
  assert.equal(out.HeaderRequest.appKey, '[REDACTED]');
  assert.equal(out.HeaderRequest.token, '[REDACTED]');
  assert.equal(out.orderCode, 'ABC');
});

test('saveCredentials writes restricted file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-mcp-'));
  const file = path.join(dir, 'credentials.json');
  process.env.SFC_CREDENTIALS_FILE = file;
  // clear env overrides
  delete process.env.SFC_APP_KEY;
  delete process.env.SFC_TOKEN;
  delete process.env.SFC_USER_ID;

  const { saveCredentials, loadCredentials, credentialsFilePath } = await import(
    '../src/config.js'
  );
  assert.equal(credentialsFilePath(), file);
  saveCredentials({
    appKey: 'k',
    token: 't',
    userId: 'u',
    divisionId: '1',
  });
  const loaded = loadCredentials();
  assert.equal(loaded.appKey, 'k');
  assert.equal(loaded.userId, 'u');
  assert.equal(loaded.divisionId, '1');
  fs.rmSync(dir, { recursive: true, force: true });
});
