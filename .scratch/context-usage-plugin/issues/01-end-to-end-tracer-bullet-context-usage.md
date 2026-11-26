# 01: 端到端骨架：Hook 會話索引、MCP Server 與基礎 Context Usage 面板

**What to build:** 跑通嚴格遵守 **Official Extension Boundary** 的首條完整垂直鏈路：當用戶在 Antigravity 中完成一次模型交互時，插件通過官方生命週期 Hook 在亞 50ms、fail-open 約束下將活躍會話元數據（`conversationId`、`modelName`、`transcriptPath` 與最後活躍時間戳）索引至 `${PLUGIN_DATA}`；用戶在 Auxiliary Side Pane 打開並停靠 Mon-My-Agy 面板時，宿主以 `{}` 調用入口 Tool，面板加載單文件自包含（無外部 CDN 腳本、符合默認嚴格 CSP）的 MCP App 界面：在無任何已索引會話時呈現清晰空狀態（靜音灰狀態點、`waiting` 徽章、隱藏無效區塊並提示完成一次對話回覆即可開始監控）；在已有會話時展示頂欄（狀態指示燈、`Mon-My-Agy` 標題、截斷模型徽章）與主指標區（`CTX_WINDOW`、**Context Usage**、內置 **Context Window Limit**、佔用百分比、水平水位條、三檔水位狀態及 `FREE` 剩餘空間），全程使用 `tabular-nums` 等寬數字防抖動並適配 320px–440px 側邊欄寬度。同時確立全倉庫兩大外部邊界測試接縫（Hook → `${PLUGIN_DATA}` → MCP Server 協議邊界，以及單文件 MCP App HTML ↔ `postMessage` Host Bridge 邊界）。

來自 UI Prototype v4 的核心遙測契約與水位判定規則（精簡版）：

```ts
// From UI Prototype v4: Telemetry Snapshot & Status Thresholds
interface ConversationTelemetry {
  model: string;
  limit: number | null; // Context Window Limit; null triggers unknown-model degradation
  uncachedInput: number;
  cacheRead: number;
  output: number;
  cumulative: {
    uncachedInput: number;
    cacheRead: number;
    output: number;
  };
}

// usage = uncachedInput + cacheRead + output
// pct = limit ? (usage / limit) * 100 : null
// remaining = limit ? Math.max(0, limit - usage) : null

function getStatusLevel(pct: number | null): 'unknown' | 'critical' | 'warning' | 'normal' {
  if (pct === null) return 'unknown';   // 文案: 上限未知
  if (pct >= 85) return 'critical';     // 文案: 危險水位
  if (pct >= 70) return 'warning';      // 文案: 預警水位
  return 'normal';                      // 文案: 健康水位
}
```

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 生命週期 Hook 接收標準 JSON Payload 後，以原子/併發安全方式更新 `${PLUGIN_DATA}` 會話索引，單次執行在 50ms 以內；遇到殘缺 Payload 或不可寫路徑時 fail-open 返回零退出碼且不影響宿主。
- [ ] MCP Server 暴露掛載 `aux_pane` 入口點與 `ui://` 資源的入口 Tool（所有入參可選，支持 `{}` 調用），同時返回文本摘要（`content`）與結構化遙測快照（`structuredContent`）；`ui://` 資源聲明 MIME 類型 `text/html;profile=mcp-app` 且為零外部腳本依賴的單文件 HTML。
- [ ] 容錯解析會話轉錄日誌計算最近一次有效調用的 **Context Usage**（`uncachedInput + cacheRead + output`）並匹配內置常見模型 **Context Window Limit** 表；當轉錄日誌缺失、為空或包含損壞 JSON 行時安全跳過或降級而不崩潰。
- [ ] 面板在無已索引會話時展示空狀態（靜音灰圓點、`waiting` 徽章、隱藏無效區塊與引導文案）；在有數據時準確渲染正常水位（`< 70%`）、預警水位（`70%–84.9%`）、危險水位（`>= 85%`）與 `FREE` 剩餘量。
- [ ] 所有數值展示啟用 `font-variant-numeric: tabular-nums`，在 320px（窄版）與 440px（標準）寬度下均無橫向溢出。
- [ ] 兩大邊界測試接縫均已落地並通過：使用真實臨時 `${PLUGIN_DATA}` 與夾具驗證 Hook → MCP Server 端到端契約，並通過模擬 `postMessage` Host Bridge 驗證單文件 HTML 的空狀態與三檔水位渲染。
