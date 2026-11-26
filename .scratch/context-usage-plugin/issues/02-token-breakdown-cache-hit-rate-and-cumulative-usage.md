# 02: Token 結構分解、Cache Hit Rate 與可折疊 Cumulative Usage

**What to build:** 在現有 **Context Usage** 主面板基礎上，向用戶完整呈現單次調用的 Token 構成與整場會話的累計消耗：面板展示最近一次模型調用的 **Cache Hit Rate** 百分比、三色分段堆疊進度條（`Cache Read`、`Uncached Input`、`Output`）及對應的三行千分位精確數值明細；同時在底部展示該會話自開始以來的 **Cumulative Usage** 總量與分類簡寫（輸入、緩存、輸出，`k` 格式），並允許用戶在面板內一鍵切換顯示或隱藏 **Cumulative Usage** 區域，以在窄屏側邊欄中按需精簡信息密度。

**Blocked by:** 01: 端到端骨架：Hook 會話索引、MCP Server 與基礎 Context Usage 面板

**Status:** done

- [x] 後端轉錄解析準確計算最近一次有效調用的 **Cache Hit Rate**（`(uncachedInput + cacheRead) > 0 ? (cacheRead / (uncachedInput + cacheRead)) * 100 : 0`）及整場會話的 **Cumulative Usage**（彙總全部有效調用的 `uncachedInput`、`cacheRead`、`output` 與總和），並通過 MCP Tool 的 `structuredContent` 返回。
- [x] 面板模塊 2 準確渲染 **Cache Hit Rate** 百分比、三段堆疊進度條與三行千分位精確數值明細（空狀態下保持隱藏）。
- [x] 面板模塊 3 準確渲染會話 **Cumulative Usage** 總計及輸入/緩存/輸出分項（簡化 `k` 格式），且支持用戶點擊開關即時顯示或隱藏該區域（空狀態下保持隱藏）。
- [x] 所有新增數值（**Cache Hit Rate**、千分位明細與 **Cumulative Usage**）均啟用 `font-variant-numeric: tabular-nums`，在 320px–440px 寬度下對齊無溢出。
- [x] 後端協議測試與前端 `postMessage` 邊界測試覆蓋 **Cache Hit Rate** 計算（含零輸入邊界）、**Cumulative Usage** 彙總與顯示/隱藏切換交互。
