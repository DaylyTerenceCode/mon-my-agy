# 06: 原生主題自適應、WCAG AA 對比度與 6 色自定義配色抽屜持久化

**What to build:** 實現面板與 Antigravity 原生視覺體系的無縫融合，並賦予用戶自定義 6 色配色的完整閉環：面板通過 `applyDocumentTheme` 與 `applyHostStyleVariables` 自動跟隨宿主的淺色/深色模式與強調色，所有狀態色、徽章、輔助文本及 `/compact` 液位填充背景的回退色均滿足 WCAG AA 對比度（≥ 4.5:1）；同時在頂欄提供調色板圖標按鈕（`28×28px`，提示 `"Colors"`），點擊展開與 `/compact` 確認欄互斥的雙列內聯配色抽屜，允許用戶實時調整上下文水位 3 檔（健康水位、預警水位、危險水位）與 Token 結構 3 類（`Cache Read`、`Uncached Input`、`Output`）的 Hex 顏色或一鍵重置為當前主題默認色，每次更改即時預覽並通過 App 專用 Tool 持久化至 `${PLUGIN_DATA}/config.json`（與 **Context Window Limit** 覆蓋映射安全共存），在重新打開面板時自動回填。

**Blocked by:** 02: Token 結構分解、Cache Hit Rate 與可折疊 Cumulative Usage; 03: `config.json` 自定義 Context Window Limit 與未知模型優雅降級; 05: 液位填充式 `/compact` 圖標按鈕、二步確認與能力門控

**Status:** ready-for-agent

- [ ] 面板在 `app.connect()` 前註冊 `onhostcontextchanged`，連接後調用 `applyDocumentTheme` 與 `applyHostStyleVariables`，完整跟隨宿主淺色/深色主題與強調色切換；所有宿主 CSS 變量均有回退值，且各類文本、狀態色與背景（含 `/compact` 液位背景）滿足 WCAG AA（≥ 4.5:1）對比度要求。
- [ ] MCP Server 提供 `visibility: ["app"]` 的配色保存/重置 Tool，將 6 色自定義配色（`success`、`warning`、`error`、`cacheRead`、`uncachedInput`、`output`）安全合併寫入 `${PLUGIN_DATA}/config.json`（不覆蓋或破壞既有 **Context Window Limit** 映射），並在入口 Tool 與輪詢查詢 Tool 響應中回傳已保存的配色；配置局部無效或損壞時安全回退至主題默認值。
- [ ] 頂欄提供 `28×28px` 線性 SVG 調色板按鈕（`title` / `aria-label` 為 `"Colors"`），點擊切換雙列內聯配色抽屜，且與 `/compact` 內聯確認欄保持互斥展開（打開其一時自動收起另一方）。
- [ ] 配色抽屜支持 6 個色項的實時取色預覽與 Hex 色值顯示，並提供「重置」（恢復當前主題默認配色）與「完成」按鈕；每次調色或重置均即時調用配色保存/重置 Tool 完成持久化。
- [ ] 後端協議測試覆蓋 6 色配置的保存、讀取回填、重置及與上限覆蓋共存；前端 `postMessage` 邊界測試覆蓋淺/深色主題與強調色切換、抽屜與 `/compact` 確認欄互斥、實時預覽、重置及觸發持久化 Tool。
