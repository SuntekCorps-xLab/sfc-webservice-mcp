# SFC WebService MCP（外部客户）

把 [SFC 官网 WebService](https://www.sfcservice.com/webservice) 做成 Cursor / Claude 等客户端可调用的 MCP 工具：查渠道、报价、下单、打面单、查轨迹、删单。

凭证只存在**客户自己电脑**上（MCP 环境变量或 `~/.sfc/credentials.json`），工具调用时自动注入，**不要**在对话里反复粘贴密钥。

## 你需要准备

向三态客户经理申请 API 三件套：

| 配置项 | 含义 |
|--------|------|
| `SFC_APP_KEY` | appKey |
| `SFC_TOKEN` | token |
| `SFC_USER_ID` | 客户 userId / 用户 code |
| `SFC_DIVISION_ID` | 可选，分拨中心，常见先试 `1`，不行再试 `17` |

## 安装（Cursor）

1. 安装 [Node.js 20+](https://nodejs.org/)
2. 克隆或下载本仓库，在仓库目录执行：

```bash
cd sfc-webservice-mcp
npm install
```

3. 在 Cursor MCP 配置中加入（路径改成你的本机绝对路径）：

```json
{
  "mcpServers": {
    "sfc-webservice": {
      "command": "node",
      "args": ["/绝对路径/sfc-webservice-mcp/src/index.js"],
      "env": {
        "SFC_APP_KEY": "你的appKey",
        "SFC_TOKEN": "你的token",
        "SFC_USER_ID": "你的userId",
        "SFC_DIVISION_ID": "1"
      }
    }
  }
}
```

4. 重启 Cursor / 重载 MCP。不要把真实密钥提交到 Git。

### 不用 env、改用本机文件

可先不配 `env`，在对话里让助手调用 `sfc_setup`（会写入 `~/.sfc/credentials.json`，权限 600）。更推荐直接用上面的 `env`。

若本机以前跑过 `sfc-webservice-skill`，也可能已有：

```text
~/.config/sfc/credentials   # KEY=VALUE，权限 600
```

MCP 会自动把它当作后备凭证源（优先级：环境变量 > `~/.sfc/credentials.json` > 该 skill 文件）。

## 工具一览

| 工具 | 作用 | 是否改数据 |
|------|------|------------|
| `sfc_setup` | 保存本机凭证 | 只写本地文件 |
| `sfc_credential_status` | 检查是否已配置（不打印密钥） | 否 |
| `sfc_verify_credentials` | 用查渠道探测账号/分拨 | 否 |
| `sfc_list_ship_types` | 可运服务列表 | 否 |
| `sfc_get_rates` | 报价 | 否 |
| `sfc_preview_order` | 下单预览（不提交） | 否 |
| `sfc_create_order` | 下单，需 `confirm=true` | **是** |
| `sfc_search_order` | 查订单 | 否 |
| `sfc_get_fee` | 查费用 | 否 |
| `sfc_get_label_url` | 生成面单 PDF 链接 | 否 |
| `sfc_get_track` | 查轨迹 | 否 |
| `sfc_delete_order` | 删单，需 `confirm=true` | **是** |

删单可用环境变量关闭：`SFC_ALLOW_DELETE=false`。

## 推荐对话流程

1. 验号：`sfc_verify_credentials`
2. 查渠道 / 报价：`sfc_list_ship_types` → `sfc_get_rates`
3. 预览下单：`sfc_preview_order` → 客户确认 → `sfc_create_order`（`confirm=true`）
4. 面单 / 轨迹：`sfc_get_label_url` / `sfc_get_track`
5. 需要取消：先 `sfc_search_order`，再 `sfc_delete_order`（`confirm=true`）

下单超时或结果不明时：**不要自动重试**，先按客户单号查询，避免重复下单。

## 官方文档

- 中文：https://www.sfcservice.com/webservice  
- 英文：https://www.sendfromchina.com/api  

字段以官网为准；本 MCP 自动带 `HeaderRequest`，调用方只填业务字段。

## 安全提醒

- 密钥只放本机 MCP 配置或 `~/.sfc/`，不要发到聊天、工单、截图、公开仓库。
- 创建订单不等于扣费；费用通常在仓库收货处理时产生（以合同/官网说明为准）。
- 本工具面向**客户自己的账号**；勿把别人的凭证配进来。
