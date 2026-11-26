import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type { StatusLevel, TelemetrySnapshot } from '../shared/types.js';

const EMPTY_GUIDANCE =
  '尚無已記錄的對話數據。完成一次對話回覆後將自動顯示 Context Usage。';

function formatFull(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

const STATUS_META: Record<Exclude<StatusLevel, 'empty'>, { label: string; barColor: string }> = {
  critical: { label: '危險水位', barColor: 'var(--mma-critical)' },
  warning: { label: '預警水位', barColor: 'var(--mma-warning)' },
  normal: { label: '健康水位', barColor: 'var(--mma-success)' },
  unknown: { label: '上限未知', barColor: 'var(--mma-accent)' },
};

function applyHostContext(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function renderSnapshot(snapshot: TelemetrySnapshot | null): void {
  const dotEl = document.getElementById('headerDot');
  const modelEl = document.getElementById('modelBadge');
  const primaryEl = document.getElementById('modPrimary');
  if (!dotEl || !modelEl || !primaryEl) return;

  if (!snapshot || !snapshot.telemetry || snapshot.statusLevel === 'empty') {
    dotEl.setAttribute('data-status', 'empty');
    modelEl.textContent = 'waiting';
    modelEl.setAttribute('title', 'waiting');
    primaryEl.innerHTML = `<div class="empty-state">${EMPTY_GUIDANCE}</div>`;
    return;
  }

  const t = snapshot.telemetry;
  const status = snapshot.statusLevel;
  const pct = t.utilizationPct;
  const barWidth = pct !== null ? Math.min(100, Math.max(0, pct)) : 100;
  const { label: statusLabel, barColor } = STATUS_META[status];
  const statusClass = `status-${status}`;

  dotEl.setAttribute('data-status', status);
  modelEl.textContent = t.model;
  modelEl.setAttribute('title', t.model);

  const usageSummary =
    t.limit !== null && pct !== null
      ? `${formatFull(t.contextUsage)} / ${formatFull(t.limit)} (${pct.toFixed(1)}%)`
      : `${formatFull(t.contextUsage)} TOKENS (LIMIT_UNKNOWN)`;

  const remainingText =
    t.remainingTokens !== null ? `FREE: ${formatFull(t.remainingTokens)}` : 'CFG: config.json';

  primaryEl.innerHTML = `
    <div class="primary-metrics">
      <div class="metrics-row">
        <span class="metrics-label">CTX_WINDOW</span>
        <span class="metrics-value tabular-nums ${statusClass}">${usageSummary}</span>
      </div>
      <div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct !== null ? Math.round(barWidth) : 0}">
        <div class="bar-fill" style="width:${barWidth}%; background:${barColor};${pct === null ? ' opacity:0.45;' : ''}"></div>
      </div>
      <div class="metrics-meta tabular-nums">
        <span>STATUS: <strong class="${statusClass}">${statusLabel}</strong></span>
        <span class="tabular-nums">${remainingText}</span>
      </div>
    </div>
  `;
}

function extractSnapshot(structuredContent: unknown): TelemetrySnapshot | null {
  if (!structuredContent || typeof structuredContent !== 'object') {
    return null;
  }
  const candidate = structuredContent as Partial<TelemetrySnapshot>;
  if (typeof candidate.statusLevel !== 'string') {
    return null;
  }
  return candidate as TelemetrySnapshot;
}

async function bootstrap(): Promise<void> {
  const app = new App({ name: 'Mon-My-Agy', version: '0.1.0' }, {});

  // Register handlers BEFORE connecting so no host notifications are missed
  app.ontoolresult = (result) => {
    renderSnapshot(extractSnapshot(result.structuredContent));
  };

  app.onhostcontextchanged = (ctx) => {
    applyHostContext(ctx);
  };

  try {
    await app.connect();
    applyHostContext(app.getHostContext());
  } catch (err) {
    console.error('[mon-my-agy] Failed to connect MCP App:', err);
  }
}

void bootstrap();
