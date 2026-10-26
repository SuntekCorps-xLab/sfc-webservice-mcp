# SFC WebService MCP

MCP server for the [SFC customer logistics WebService](https://www.sfcservice.com/webservice) (rates, create/delete orders, labels, tracking).

**Chinese install guide:** [README.zh-CN.md](./README.zh-CN.md)

Credentials stay on the **customer machine** (MCP `env` or `~/.sfc/credentials.json`). Tools inject `HeaderRequest` automatically — never put secrets in chat or source control.

## Requirements

- Node.js 20+
- SFC-issued `appKey`, `token`, `userId` (ask your SFC account manager)

## Cursor install

```bash
cd sfc-webservice-mcp
npm install
```

Add to Cursor MCP settings (use your absolute path):

```json
{
  "mcpServers": {
    "sfc-webservice": {
      "command": "node",
      "args": ["/absolute/path/sfc-webservice-mcp/src/index.js"],
      "env": {
        "SFC_APP_KEY": "your-app-key",
        "SFC_TOKEN": "your-token",
        "SFC_USER_ID": "your-user-id",
        "SFC_DIVISION_ID": "1"
      }
    }
  }
}
```

Optional: omit `env` and call tool `sfc_setup` once to write `~/.sfc/credentials.json` (mode `600`).

## Tools

| Tool | Purpose | Mutates |
|------|---------|---------|
| `sfc_setup` | Save local credentials | local file only |
| `sfc_credential_status` | Check config (no secrets) | no |
| `sfc_verify_credentials` | Probe ship types / division | no |
| `sfc_list_ship_types` | List methods | no |
| `sfc_get_rates` | Quote | no |
| `sfc_preview_order` | Build order payload | no |
| `sfc_create_order` | Submit order (`confirm=true`) | **yes** |
| `sfc_search_order` | Order lookup | no |
| `sfc_get_fee` | Fee by order | no |
| `sfc_get_label_url` | Label PDF URL | no |
| `sfc_get_track` | Tracking | no |
| `sfc_delete_order` | Delete (`confirm=true`) | **yes** |

Disable delete with `SFC_ALLOW_DELETE=false`.

## Suggested flow

1. `sfc_verify_credentials`
2. `sfc_list_ship_types` → `sfc_get_rates`
3. `sfc_preview_order` → customer OK → `sfc_create_order` with `confirm=true`
4. `sfc_get_label_url` / `sfc_get_track`
5. Cancel: `sfc_search_order` then `sfc_delete_order` with `confirm=true`

On timeout / unknown create result: **do not retry** — search by customer order number first.

## Official docs

- https://www.sfcservice.com/webservice  
- https://www.sendfromchina.com/api  

Field schemas on those pages are authoritative.

## Develop

```bash
npm install
npm run check
npm test
npm start   # stdio MCP (used by the host)
```

See `.env.example` for optional host overrides.
