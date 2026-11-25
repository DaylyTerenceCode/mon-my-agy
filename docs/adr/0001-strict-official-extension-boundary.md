---
status: accepted
---

# Strictly Enforce Official Extension Boundary and Exclude Account Quota

To ensure long-term stability, security, and Antigravity Marketplace compliance, this plugin strictly adheres to the Official Extension Boundary: it only consumes documented lifecycle hook payloads (`transcriptPath`, `conversationId`, `modelName`) and renders exclusively through official plugin UI surfaces. Account-level multi-model quota monitoring and host DOM injection (such as composer-adjacent floating capsules used by community tools like `agy-capsule`) are explicitly out of scope because no official public API or UI slot exists for them.

## Considered Options

- **Private LS RPC + Host DOM Injection (rejected)**: Provides composer-adjacent floating capsules and account quota tracking, but breaks across host updates and violates Marketplace compliance boundaries.
- **Official Extension Boundary Only (accepted)**: Limits metrics to per-conversation Context Usage, cache hit rate, and token trends derived from `transcript.jsonl`, with a configurable model Context Window Limit table and official UI surfaces.

## Consequences

- Users cannot see account-wide quota percentages or a floating capsule attached directly to the chat input box.
- Model Context Window Limits must be maintained via a bundled lookup table with user-overridable mappings, degrading gracefully to absolute token counts for unknown models.
