# 04: 可見態定時輪詢、手動刷新與多會話切換器

**What to build:** 讓常駐於 Auxiliary Side Pane 的面板在連續對話中自動保持實時更新，並支持手動即時刷新及跨會話切換查看：後端暴露僅對 App 可見（`visibility: ["app"]`）的查詢/刷新 MCP Tool；前端在頁面可見時通過 `app.callServerTool()` 按單請求在途約束定時輪詢最新快照（不可見時暫停輪詢），在頂欄提供手動刷新圖標按鈕（懸停提示 `"Refresh"`）立即拉取最新數據，並提供按最近活躍時間倒序排列的會話切換下拉框以按 `conversationId` 切換查看不同已索引會話的 **Context Usage**。

**Blocked by:** 01: 端到端骨架：Hook 會話索引、MCP Server 與基礎 Context Usage 面板

**Status:** done

- [x] MCP Server 提供 `visibility: ["app"]`（對模型不可見）的查詢/刷新 Tool，支持返回按最近活躍時間倒序排列的近期會話列表及指定 `conversationId`（或默認最近活躍會話）的最新遙測快照。
- [x] 面板僅在頁面可見時啟動定時輪詢，並保證同一時刻至多僅有一個輪詢請求在途（避免觸發宿主併發上限）；頁面隱藏時停止輪詢。
- [x] 頂欄提供 `28×28px` 線性 SVG 手動刷新圖標按鈕（`title` / `aria-label` 為 `"Refresh"`），點擊後立即觸發 App 專用查詢 Tool 刷新當前視圖。
- [x] 面板展示會話切換下拉框（空狀態時隱藏），列出 `${PLUGIN_DATA}` 索引中的近期會話，切換選項後向 App 專用 Tool 傳入對應 `conversationId` 並更新面板全部指標。
- [x] 後端協議測試覆蓋多會話排序與按 `conversationId` 查詢；前端 `postMessage` 邊界測試覆蓋手動刷新按鈕、會話切換觸發對應 `callServerTool` 並更新視圖，以及單在途輪詢行為。
