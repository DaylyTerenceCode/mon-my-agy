# Context Usage Plugin (Mon-My-Agy)

Status: ready-for-agent

## Problem Statement

在 Antigravity 中進行長會話編碼或複雜任務協作時，開發者無法直觀掌握當前會話的 **Context Usage**、剩餘可用空間以及提示詞緩存命中情況。當上下文接近模型的 **Context Window Limit** 時，用戶往往只能在模型表現退化或觸發截斷後才被動察覺，難以及時執行 `/compact` 壓縮上下文。

現有社區方案多依賴私有 RPC、未公開內部狀態文件或向宿主注入浮動 DOM 膠囊，既容易在宿主版本更新後失效，也無法滿足 Antigravity 插件市場的合規與安全要求。開發者需要一個嚴格遵守 **Official Extension Boundary**、零聊天流污染、可常駐側邊欄實時觀測上下文水位的輕量級監控插件。

## Solution

構建名為 **Mon-My-Agy** 的 Antigravity 插件，通過「生命週期 Hook 索引 + `${PLUGIN_DATA}` 數據橋接 + Auxiliary Side Pane MCP App」的標準擴展架構，為開發者提供高信息密度的實時 **Context Usage** 監控面板：

- 每次模型交互觸發生命週期 Hook 時，插件以亞 50ms、fail-open 的方式將活躍會話元數據（`conversationId`、`modelName`、`transcriptPath`）索引至 `${PLUGIN_DATA}`，全程不產生額外模型 Token 消耗，也不在聊天記錄中插入任何狀態消息。
- 用戶從 `Plugins >` 打開並停靠 Auxiliary Side Pane 中的 Mon-My-Agy 面板後，面板自動跟蹤最近活躍會話（並支持手動切換其他已索引會話），實時展示：
  1. **Context Usage** 絕對數值、**Context Window Limit**、佔用百分比、剩餘空間與四檔水位狀態（健康水位 / 預警水位 / 危險水位 / 上限未知）。
  2. Token 結構分解條形圖與明細（`Cache Read`、`Uncached Input`、`Output`）及 **Cache Hit Rate**。
  3. 會話 **Cumulative Usage**（支持用戶切換顯示或隱藏）。
  4. 帶液位進度填充視覺反饋的圖標化 `/compact` 快捷按鈕（含二步內聯確認機制）、手動刷新按鈕及插件內置的 6 色自定義配色抽屜（上下文水位 3 檔 + Token 結構 3 類，支持即時持久化與一鍵重置）。
- 內置常見模型 **Context Window Limit** 映射表，並支持通過用戶配置文件覆蓋或補充自定義模型上限；遇到未知模型時優雅降級為絕對 Token 數展示。

## User Stories

1. 作為 Antigravity 用戶，我希望在 Auxiliary Side Pane 中打開並停靠 Mon-My-Agy 面板，以便在不干擾主對話流的情況下持續查看當前會話的 **Context Usage**。
2. 作為 Antigravity 用戶，我希望每次會話產生新回覆後插件自動追蹤當前活躍會話，以便無需手動複製會話 ID 或路徑即可看到最新遙測數據。
3. 作為 Antigravity 用戶，我希望在無任何已索引會話時看到清晰的空狀態引導文案（並隱藏無效的會話選擇器與指標區域），以便理解只需完成一次對話回覆即可開始監控。
4. 作為 Antigravity 用戶，我希望在面板頂部一眼看到當前會話的狀態指示燈、插件名稱與當前使用的模型徽章（`modelName`），以便快速確認當前監控對象。
5. 作為 Antigravity 用戶，我希望看到當前會話最近一次模型調用的 **Context Usage**（`Uncached Input + Cache Read + Output`）與該模型的 **Context Window Limit** 及佔用百分比，以便準確評估上下文剩餘空間。
6. 作為 Antigravity 用戶，我希望看到當前上下文的剩餘可用 Token 數（`FREE`），以便判斷還剩多少空間可繼續輸入代碼或文檔。
7. 作為 Antigravity 用戶，我希望根據 **Context Usage** 佔用百分比自動切換狀態顏色與文案（`< 70%` 為健康水位、`70%–84.9%` 為預警水位、`>= 85%` 為危險水位），以便第一時間識別高水位風險。
8. 作為 Antigravity 用戶，我希望當模型不在內置 **Context Window Limit** 表中且未自定義配置時，面板優雅降級為顯示絕對 Token 數與「上限未知」狀態並提示可通過 `config.json` 配置，以便仍能觀測上下文規模而不會報錯崩潰。
9. 作為 Antigravity 用戶，我希望通過 `${PLUGIN_DATA}` 中的用戶配置文件覆蓋已有模型的 **Context Window Limit** 或為新發布/自定義模型補充上限，以便無需等待插件更新即可獲得準確百分比。
10. 作為 Antigravity 用戶，我希望查看最近一次調用的 Token 結構分解（`Cache Read`、`Uncached Input`、`Output` 的三段堆疊進度條及精確千分位數值），以便理解上下文主要由緩存還是新增輸入構成。
11. 作為 Antigravity 用戶，我希望查看當前調用的 **Cache Hit Rate**（`Cache Read / (Cache Read + Uncached Input)` 的百分比），以便判斷提示詞緩存是否有效命中。
12. 作為 Antigravity 用戶，我希望查看當前會話自開始以來的 **Cumulative Usage** 總量及分類匯總（輸入、緩存、輸出），以便區分單次窗口佔用與整個會話的累計消耗。
13. 作為 Antigravity 用戶，我希望能夠按需開關「顯示會話累計消耗」區域，以便在窄屏側邊欄中進一步精簡信息密度。
14. 作為 Antigravity 用戶，我希望在面板可見時自動定時輪詢最新快照，以便在連續對話過程中無需頻繁手動刷新即可看到實時變化的水位。
15. 作為 Antigravity 用戶，我希望點擊頂部的手動刷新圖標按鈕（懸停提示 `"Refresh"`）立即拉取最新數據，以便在模型剛剛回覆完畢時即時確認最新 **Context Usage**。
16. 作為 Antigravity 用戶，我希望頂部的 `/compact` 按鈕以雙倍寬度的純壓縮圖標按鈕呈現（不再顯示 `"/compact"` 文本，懸停提示 `"Compact"`），其背景以液位進度條形式同步映射當前 **Context Usage** 百分比與狀態顏色使其成為視覺主體，圖標默認色與刷新按鈕一致並在懸停時轉為深色/高對比前景色，以便在極窄側邊欄中節省空間並獲得直觀的高水位視覺提示。
17. 作為 Antigravity 用戶，我希望點擊 `/compact` 按鈕後先展開二步內聯確認欄（提供「確認」與「取消」按鈕），以便防止誤觸導致正在進行的上下文被意外壓縮。
18. 作為 Antigravity 用戶，我希望在確認執行 `/compact` 後由面板通過官方 MCP App 能力向當前對話發送 `/compact` 消息並給出反饋提示，以便一鍵觸發上下文壓縮。
19. 作為 Antigravity 用戶，我希望在宿主環境不提供 `message` 能力（例如全局視圖）時自動隱藏或禁用 `/compact` 發送入口，以便避免出現點擊無效或報錯的交互。
20. 作為 Antigravity 用戶，我希望通過面板中的會話切換下拉框在多個已索引的近期會話之間切換查看，以便同時對比或回顧不同任務會話的 **Context Usage**。
21. 作為 Antigravity 用戶，我希望當面板處於窄版（320px）或標準寬度（440px）側邊欄中時佈局均保持清晰對齊、不發生橫向溢出，且所有數值一律使用 `font-variant-numeric: tabular-nums`（等寬數字防抖動），確保實時刷新時文字與數字絕不左右跳動。
22. 作為 Antigravity 用戶，我希望面板自動跟隨 Antigravity 當前的淺色 / 深色模式與強調色（Accent Color），並確保所有文字與背景至少滿足 WCAG AA 對比度（≥ 4.5:1），讓插件看起來像原生界面的一部分，而非生硬的外掛 iframe。
23. 作為 Antigravity 用戶，我希望生命週期 Hook 執行極快（亞 50ms）且在磁盤寫入失敗或 Payload 異常時 fail-open 靜默降級，以便插件絕不阻塞或中斷正常對話流程。
24. 作為 Antigravity 用戶，我希望當某個會話的 `transcript.jsonl` 暫時不存在、為空、或包含損壞/不完整的 JSON 行時，插件能夠安全跳過異常行或返回降級狀態，以便面板始終穩定可用。
25. 作為 Antigravity 用戶，我希望直接在插件頂欄點擊調色板圖標按鈕（懸停提示 `"Colors"`）展開內聯配色抽屜，自由調整上下文水位 3 個檔位（健康水位、預警水位、危險水位）與 Token 結構分解 3 種類型（`Cache Read`、`Uncached Input`、`Output`）的顏色並支持一鍵重置默認與自動持久化，以便打造符合個人審美與視認習慣的監控面板。
26. 作為 Antigravity 插件生態維護者，我希望插件嚴格遵守 **Official Extension Boundary**，不調用私有 RPC、不注入宿主 DOM、不依賴外部 CDN 腳本（單文件自包含 HTML 以符合默認 CSP），以便順利通過插件市場審核並在宿主升級後保持穩定。

## Implementation Decisions

### 1. 架構邊界與插件組成（遵循 ADR-0001 與 ADR-0002）
- 嚴格遵守 **Official Extension Boundary**：僅消費官方生命週期 Hook Payload（`conversationId`、`modelName`、`transcriptPath`）並通過官方 MCP App（SEP-1865）表面渲染，不引入 Sidecar HTTP 服務、不輸出 `user_markdown` 內聯消息、不追蹤賬號級多模型配額。
- 插件打包為標準 Antigravity 插件目錄，包含以下邏輯模塊：
  1. **Lifecycle Hook Indexer**：由 `hooks.json` 註冊並在相關會話生命週期事件觸發時執行。從標準輸入讀取 Hook Payload，以原子寫入或安全併發寫入方式更新 `${PLUGIN_DATA}` 中的會話索引（記錄 `conversationId`、`modelName`、`transcriptPath`、會話標題/摘要以及最後活躍時間戳）。設計約束：單次執行控制在 50ms 以內，任何 I/O 或解析異常均必須 fail-open（返回零退出碼且不影響宿主）。
  2. **Transcript Telemetry Parser & Limit Resolver**：讀取目標會話的 `transcript.jsonl`，逐行容錯解析模型調用記錄中的 Token 用量字段，計算：
     - **Context Usage**（取最近一次有效模型調用的 `uncachedInput + cacheRead + output`）
     - **Cache Hit Rate**（`totalInput > 0 ? (cacheRead / totalInput) * 100 : 0`，其中 `totalInput = uncachedInput + cacheRead`）
     - **Cumulative Usage**（彙總該會話所有有效調用的 `uncachedInput`、`cacheRead`、`output` 及總和）
     - **Context Window Limit** 解析順序：優先讀取 `${PLUGIN_DATA}` 下的用戶 `config.json` 覆蓋映射，其次回退至插件內置的模型上限查找表；若均未命中則返回 `null`（觸發未知模型降級）。
  3. **MCP Server**：通過 `mcp_config.json` 啟動並接收 `${PLUGIN_DATA}` 路徑參數，對外暴露：
     - **Auxiliary Side Pane 入口 Tool**（掛載 `ui.resourceUri` 指向 `ui://` 資源，並聲明 `com.google.antigravity/ui.entrypoints` 包含 `aux_pane`）：所有入參均為可選，被宿主以 `{}` 調用時自動返回最近活躍會話的完整遙測快照（同時包含 `content` 文本摘要與 `structuredContent` 結構化數據）。
     - **App 專用查詢與偏好持久化 Tool**（`visibility: ["app"]`，對模型不可見）：
       - 查詢/刷新 Tool：供前端面板定時輪詢、手動刷新及按 `conversationId` 切換會話時調用，返回最新會話列表、目標會話快照及當前已保存的用戶自定義配色。
       - 配色保存/重置 Tool：供前端在用戶調整或重置 6 色自定義配色時即時調用，將配置持久化至 `${PLUGIN_DATA}/config.json`（因隔離 iframe 不保留 `localStorage` 且宿主不發送 teardown 事件）。
     - **單文件 UI 資源**（`ui://` URI，MIME 類型 `text/html;profile=mcp-app`）：由構建流程將 `@modelcontextprotocol/ext-apps` SDK 與所有樣式/腳本內聯打包為單一自包含 HTML，無需放寬默認 CSP 的 `resourceDomains` 或 `connectDomains`。
  4. **MCP App Frontend**：基於 `@modelcontextprotocol/ext-apps` 的 `App` 類完成握手與生命週期管理：
     - 在 `app.connect()` 前註冊 `ontoolresult` 與 `onhostcontextchanged`；連接後調用 `applyDocumentTheme` 與 `applyHostStyleVariables`，並為所有標準宿主 CSS 變量提供回退值。
     - 由於 Antigravity 不發送 `ui/resource-teardown` 且默認 CSP 禁止 `fetch`/WebSocket，面板僅在頁面可見時通過 `app.callServerTool()` 定時輪詢 App 專用查詢 Tool（並保證同一時刻僅有一個輪詢請求在途，避免觸發 4 個併發請求上限）。
     - 檢查 `app.getHostCapabilities()`：僅當存在 `message` 能力時啟用 `/compact` 按鈕的發送流程（通過 `app.sendMessage()` 發送 `/compact` 文本）；否則隱藏或禁用該交互。

### 2. 遙測數據契約與水位判定邏輯（源自 UI Prototype v4）
以下水位閾值、狀態文案與指標計算規則直接源自已定稿的 UI 原型（已精簡為核心決策邏輯）：

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

// Derived metrics:
// usage = uncachedInput + cacheRead + output
// pct = limit ? (usage / limit) * 100 : null
// remaining = limit ? Math.max(0, limit - usage) : null
// cacheHitRate = (uncachedInput + cacheRead) > 0
//   ? (cacheRead / (uncachedInput + cacheRead)) * 100
//   : 0

function getStatusLevel(pct: number | null): 'unknown' | 'critical' | 'warning' | 'normal' {
  if (pct === null) return 'unknown';   // 文案: 上限未知
  if (pct >= 85) return 'critical';     // 文案: 危險水位
  if (pct >= 70) return 'warning';      // 文案: 預警水位
  return 'normal';                      // 文案: 健康水位
}
```

### 3. UI 交互與佈局決策（源自 UI Prototype v4）
- **極致密度三模塊結構**：
  1. **Header**：狀態圓點、`Mon-My-Agy` 標題、截斷顯示的模型名稱徽章，以及右側三個純圖標操作按鈕：
     - **液位填充式 `/compact` 圖標按鈕**：寬度為刷新按鈕的兩倍（`56×28px`），使用內聯 SVG 壓縮圖標，不再顯示 `"/compact"` 文本，懸停提示（`title` / `aria-label`）為 `"Compact"`；內部液位進度條寬度與顏色隨 `pct` 與狀態色變化使其成為視覺主體（未知模型或空狀態時寬度為 `0%`），圖標默認色與刷新按鈕一致（弱化前景色），僅在 `hover` 時變為深色/高對比前景色。
     - **手動刷新按鈕**：`28×28px` 線性 SVG 刷新圖標，懸停提示（`title` / `aria-label`）為 `"Refresh"`。
     - **自定義配色按鈕**：`28×28px` 線性 SVG 調色板圖標，懸停提示（`title` / `aria-label`）為 `"Colors"`，用於開關內聯配色抽屜。
  2. **二步內聯確認欄與內聯配色抽屜（互斥展開）**：
     - 點擊 `/compact` 切換顯示內聯確認欄（同時收起配色抽屜），點擊「取消」或切換會話時自動收起，點擊「確認」後調用 `app.sendMessage("/compact")` 並展示簡短 Toast 反饋。
     - 點擊 `Colors` 切換顯示雙列內聯配色抽屜（同時收起 `/compact` 確認欄），提供上下文水位 3 檔（健康水位、預警水位、危險水位）與 Token 結構 3 類（`Cache`、`Input`、`Output`）的實時取色器與 Hex 色值顯示，並提供「重置」（恢復當前主題默認配色）與「完成」按鈕；每次調色或重置均實時預覽並通過 App 專用 Tool 持久化至 `${PLUGIN_DATA}/config.json`。
  3. **會話切換器**：列出 `${PLUGIN_DATA}` 索引中的近期會話（按最近活躍時間倒序），空狀態時隱藏。
  4. **主遙測體**：
     - 模塊 1（Primary Context Usage）：`CTX_WINDOW` 標籤、`已用 / 上限 (百分比%)` 或 `已用 TOKENS (LIMIT_UNKNOWN)`、單行水平水位條、`STATUS` 狀態文案與 `FREE` 剩餘量（未知模型時顯示 `CFG: config.json`）。
     - 模塊 2（Token 結構分解）：標題與 **Cache Hit Rate** 百分比、三色分段堆疊進度條（`Cache Read` / `Uncached Input` / `Output`）與三行精確千分位數值明細。
     - 模塊 3（會話累計消耗）：顯示 **Cumulative Usage** 總計及輸入/緩存/輸出分項（簡化 `k` 格式），支持用戶在面板內切換顯示或隱藏。
- **空狀態**：當索引中無任何會話數據時，狀態點為靜音灰、模型徽章顯示 `waiting`、隱藏會話選擇器與模塊 2/3，在模塊 1 顯示簡潔引導文案。
- **響應式、等寬數字防抖動與主題對比度**：
  - 適配 320px（窄版）至 440px（標準）側邊欄寬度，進度條切換帶平滑過渡。
  - **等寬數字防抖動**：所有數值展示（包含 **Context Usage**、**Context Window Limit**、佔用百分比、剩餘空間、**Cache Hit Rate**、Token 結構明細與 **Cumulative Usage**）一律啟用 `font-variant-numeric: tabular-nums`，確保輪詢與實時刷新時文字與數字不左右跳動。
  - **主題與對比度自適應**：通過 `applyDocumentTheme` 與 `applyHostStyleVariables` 自動跟隨 Antigravity 當前的淺色 / 深色模式與強調色（Accent Color），且所有狀態色、徽章、輔助說明文字與其所在背景（包含 `/compact` 液位填充背景與內置回退色）均須滿足至少 WCAG AA 對比度（≥ 4.5:1），呈現原生級視覺融合感。

### 4. 配置與配色持久化契約（`config.json`）
- 存儲於 `${PLUGIN_DATA}` 目錄下，同時承載：
  - **Context Window Limit 覆蓋映射**：模型名稱（精確匹配或標準化前綴匹配）到正整數上限的映射。
  - **用戶自定義配色（可選）**：上下文水位 3 檔（`success` / `warning` / `error`）與 Token 結構 3 類（`cacheRead` / `uncachedInput` / `output`）的 Hex 色值覆蓋；未設置項自動回退至當前宿主主題變量。
- `config.json` 缺失、為空、局部字段無效或格式損壞時必須安全降級為默認值，不得導致 MCP Server 啟動或查詢失敗。

## Testing Decisions

### 什麼是好測試
- 僅測試跨邊界的外部可觀測行為（Hook 標準輸入到 MCP 協議響應、單文件 HTML 與宿主 `postMessage` 的協議交互與 DOM 呈現），絕不針對內部解析函數、私有狀態變量或樣式實現細節編寫脆弱的單元斷言。
- 所有數據測試基於真實的臨時 `${PLUGIN_DATA}` 目錄與夾具文件（`transcript.jsonl`、`config.json`）運行，不 Mock 文件系統或內部數據存儲層。

### 測試接縫（Seams）
本項目為全新倉庫（尚無既有測試先例），確立以下兩處最高層級測試接縫作為全倉庫的測試基準：

1. **後端與數據橋接接縫（Hook → `${PLUGIN_DATA}` → MCP Server 協議邊界）**
   - **驅動方式**：為每個測試用例分配獨立的臨時 `${PLUGIN_DATA}` 目錄與夾具 `transcript.jsonl` / `config.json`；寫入側直接調用生命週期 Hook 入口傳入標準 JSON Payload，讀取側通過真實 MCP Client 連接 MCP Server，以 `{}` 調用 `aux_pane` 入口 Tool、調用 App 專用輪詢/切換 Tool 並讀取 `ui://` 資源。
   - **覆蓋場景**：
     - 正常索引與首次打開空狀態；
     - **Context Usage**、**Cumulative Usage**、**Cache Hit Rate** 精確計算與水位分類（`<70%`、`70%–84.9%`、`>=85%`）；
     - 內置 **Context Window Limit** 命中、`config.json` 自定義上限覆蓋與未知模型降級（`limit: null`）；
     - 通過 App 專用 Tool 保存、讀取與重置 6 色自定義配色至 `${PLUGIN_DATA}/config.json`，並在重新打開時正確回填；
     - 多會話索引按最近活躍排序與按 `conversationId` 切換；
     - Fail-open 與容錯：Hook 收到殘缺 Payload 或不可寫路徑時不拋錯阻塞；`transcript.jsonl` 缺失、為空或含損壞 JSON 行時安全降級；`config.json` 語法錯誤時回退內置表；
     - `ui://` 資源返回有效單文件 HTML 且聲明正確 MIME 類型（`text/html;profile=mcp-app`），無外部腳本依賴。

2. **前端 UI 接縫（單文件 MCP App HTML ↔ `postMessage` Host Bridge 邊界）**
   - **驅動方式**：在瀏覽器/DOM 測試環境中加載構建產出的單文件 MCP App HTML，外層掛載模擬 Antigravity Host 的 `postMessage` JSON-RPC 橋接器（處理 `ui/initialize`、下發 `hostContext` 主題與 `ontoolresult` 快照、攔截 `callServerTool` 與 `sendMessage`）。
   - **覆蓋場景**：
     - 五種核心狀態渲染：正常水位（21%）、預警水位（78%）、危險水位（93%）、未知模型、空狀態；
     - 雙倍寬度液位填充 `/compact` 圖標按鈕（無 `"/compact"` 文本、懸停提示 `"Compact"`、圖標默認弱化色與 hover 前景色）、進度寬度與二步內聯確認流程（取消不發送、確認後向 Host 發出 `sendMessage("/compact")`）；
     - Host 不具備 `message` 能力時自動隱藏或禁用 `/compact` 交互；
     - `Colors` 內聯配色抽屜開關（與 `/compact` 確認欄互斥）、6 色實時選色預覽、一鍵重置默認與觸發 App 專用保存 Tool；
     - 手動刷新按鈕（懸停提示 `"Refresh"`）、會話切換下拉框觸發對應 `callServerTool` 並更新視圖、累計消耗區域顯示開關、數值區域啟用 `tabular-nums`，以及淺色/深色主題與強調色切換（驗證回退與對比度合規）。

## Out of Scope

- 賬號級多模型配額百分比監控（ADR-0001 明確排除）。
- 私有 Language Server RPC 調用、未公開內部狀態文件讀取、以及向聊天輸入框附近注入浮動膠囊（Host DOM Injection）（ADR-0001 明確排除）。
- 常駐後台 HTTP / WebSocket Sidecar 服務（`sidecar.json`）（ADR-0002 明確排除）。
- 在聊天流中插入 `user_markdown` 內聯狀態文本（ADR-0002 明確排除）。
- 在 Antigravity 啟動時未經用戶操作強制彈出 Auxiliary Side Pane（受官方平台約束，ADR-0002 已說明）。
- 多輪歷史趨勢折線圖/面積圖與外部數據導出功能（未納入 UI Prototype v4，留待後續版本評估）。

## Further Notes

- **領域詞彙一致性**：實現與測試命名應嚴格遵循倉庫 `GLOSSARY.md` 定義的核心術語（`Context Usage`、`Cumulative Usage`、`Context Window Limit`、`Official Extension Boundary`、`Cache Hit Rate`），避免混用被禁止的同義詞（如 `Total tokens`、`Quota`、`Rate limit`、`Cache efficiency`）。
- **參考依據**：本規格綜合自 `ADR-0001`、`ADR-0002`、`GLOSSARY.md` 與 `UI Prototype v4`，未發現與既有 ADR 的衝突。
- **CSP 注意事項**：原型 HTML 中用於快速預覽的外部 Tailwind CDN 腳本在正式構建的 MCP App 單文件 HTML 中**不可保留**，所有樣式必須內聯編譯打包，以確保在 Antigravity 默認嚴格 CSP（`default-src 'none'`）下無報錯運行。
