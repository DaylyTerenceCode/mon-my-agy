---
status: accepted
---

# Use MCP App in Auxiliary Side Pane Bridged by Lifecycle Hooks via PLUGIN_DATA

We render the Context Usage dashboard as a standard MCP App (`aux_pane` entrypoint) in the Auxiliary Side Pane and use lightweight lifecycle hooks (`hooks.json`) to index active conversations into `${PLUGIN_DATA}`. Because Antigravity invokes `aux_pane` entrypoint tools with `{}` (without `conversationId` or `transcriptPath`), while lifecycle hooks are the only official surface receiving `conversationId`, `modelName`, and `transcriptPath`, bridging them through `${PLUGIN_DATA}` enables zero-token-cost automatic tracking of the active conversation without polluting the chat stream.

## Considered Options

- **Sidecar Web UI (`sidecar.json`)**: Supports server-push updates over HTTP/WebSocket, but requires managing a persistent background HTTP server and port lifecycle, and is less portable than standard MCP Apps (SEP-1865).
- **Hook-Only Inline Rendering (`user_markdown`)**: Zero background server overhead, but appends status lines into the chat transcript and cannot render interactive breakdowns or trend charts.
- **MCP App + Hook `PLUGIN_DATA` Bridge (accepted)**: Standard Marketplace-compliant MCP App with automatic host theming and CSP isolation, zero chat-stream pollution, and sub-50ms fail-open hook indexing.

## Consequences

- The MCP App cannot receive server-pushed events natively under default CSP and must poll its own app-only server tool while visible.
- The plugin cannot force-open the Auxiliary Side Pane on app startup without user action; users open it once from `Plugins >` (or trigger an optional skill/tool call to leverage host auto-open) and keep it docked.
