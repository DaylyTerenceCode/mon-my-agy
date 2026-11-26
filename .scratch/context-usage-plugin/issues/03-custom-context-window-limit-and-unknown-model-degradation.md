# 03: `config.json` 自定義 Context Window Limit 與未知模型優雅降級

**What to build:** 讓用戶無需等待插件更新即可通過 `${PLUGIN_DATA}` 下的用戶配置文件（`config.json`）覆蓋已有模型的 **Context Window Limit** 或為新發布/自定義模型補充上限；當模型既不在 `config.json` 覆蓋映射中也不在內置表中時，面板優雅降級為「上限未知」模式，繼續穩定展示絕對 Token 數並引導用戶通過 `config.json` 進行配置，而不報錯或崩潰。

**Blocked by:** 01: 端到端骨架：Hook 會話索引、MCP Server 與基礎 Context Usage 面板

**Status:** ready-for-agent

- [ ] **Context Window Limit** 解析嚴格遵循優先級：先讀取 `${PLUGIN_DATA}/config.json` 的覆蓋映射（支持模型名稱精確匹配或標準化前綴匹配，僅接受正整數），未命中則回退內置查找表，均未命中則返回 `null`。
- [ ] 當 `config.json` 缺失、為空、局部字段無效或存在 JSON 語法錯誤時，MCP Server 安全回退至默認內置表且不影響啟動或查詢。
- [ ] 當快照返回 `limit: null`（未知模型）時，面板渲染 `上限未知`（`unknown`）狀態：顯示 `已用 TOKENS (LIMIT_UNKNOWN)`、`0%` 水位條與 `CFG: config.json` 提示，且不顯示無意義的百分比或負值剩餘量。
- [ ] 後端協議測試覆蓋 `config.json` 自定義上限覆蓋、非法配置安全回退與未知模型返回 `limit: null`；前端 `postMessage` 邊界測試覆蓋未知模型降級渲染。
