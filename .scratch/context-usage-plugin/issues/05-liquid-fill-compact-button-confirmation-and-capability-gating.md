# 05: 液位填充式 `/compact` 圖標按鈕、二步確認與能力門控

**What to build:** 在面板頂欄提供兼具高水位視覺提示與防誤觸保護的一鍵 `/compact` 壓縮入口：按鈕為雙倍寬度（`56×28px`）的純壓縮圖標按鈕（不顯示 `"/compact"` 文本，懸停提示 `"Compact"`），其內部背景以液位進度條形式實時同步當前 **Context Usage** 百分比與對應水位狀態色（未知模型或空狀態時液位寬度為 `0%`），圖標默認採用與刷新按鈕一致的弱化前景色並在懸停時轉為高對比前景色。用戶點擊按鈕後展開二步內聯確認欄（提供「確認」與「取消」按鈕，取消或切換會話時自動收起）；確認後通過官方 MCP App `app.sendMessage("/compact")` 向當前對話發送壓縮指令並顯示簡短 Toast 反饋；當宿主不具備 `message` 能力時自動隱藏或禁用該入口。

**Blocked by:** 01: 端到端骨架：Hook 會話索引、MCP Server 與基礎 Context Usage 面板

**Status:** done

- [x] 頂欄渲染雙倍寬度（`56×28px`）內聯 SVG 壓縮圖標按鈕，不含 `"/compact"` 文本，`title` / `aria-label` 為 `"Compact"`；背景液位進度條寬度與顏色隨當前 **Context Usage** 百分比與水位狀態實時聯動（空狀態及未知模型時為 `0%`），圖標默認色與刷新按鈕一致、懸停轉為高對比前景色。
- [x] 點擊 `/compact` 按鈕切換展開二步內聯確認欄（含「確認」與「取消」按鈕）；點擊「取消」或切換會話時自動收起且不向宿主發送任何消息。
- [x] 點擊「確認」後調用 `app.sendMessage("/compact")` 發送消息、收起確認欄並展示簡短 Toast 反饋提示。
- [x] 初始化後檢查 `app.getHostCapabilities()`：當宿主不支持 `message` 能力時，自動隱藏或禁用 `/compact` 交互入口。
- [x] 前端 `postMessage` 邊界測試覆蓋按鈕樣式與液位寬度聯動、取消不發送、確認觸發 `sendMessage("/compact")` 及無 `message` 能力時的門控表現。
