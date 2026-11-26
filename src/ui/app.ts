import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import {
  APP_QUERY_TOOL_NAME,
  type ConversationSummary,
  type ConversationTelemetry,
  type StatusLevel,
  type TelemetrySnapshot,
} from '../shared/types.js';

const EMPTY_GUIDANCE =
  '尚無已記錄的對話數據。完成一次對話回覆後將自動顯示 Context Usage。';
const POLL_INTERVAL_MS = 3000;
const TOAST_DURATION_MS = 2200;

function formatFull(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US');
}

function formatCompact(n: number): string {
  const safe = Math.max(0, Math.floor(n));
  return safe >= 1000 ? `${(safe / 1000).toFixed(1)}k` : String(safe);
}

let showCumulative = true;
let selectedConversationId: string | undefined;
let isFetching = false;
let pendingRequest: { conversationId?: string } | null = null;
let pollTimerId: number | null = null;
let toastTimerId: number | null = null;
let confirmingCompact = false;
let hasActiveTelemetry = false;
let hostSupportsMessage = false;
let isSendingCompact = false;
let appInstance: App | null = null;

function renderConversationSwitcher(
  conversations: ConversationSummary[],
  activeConversationId: string | null,
): void {
  const convBar = document.getElementById('convBar');
  const convSelect = document.getElementById('convSelect') as HTMLSelectElement | null;
  if (!convBar || !convSelect) return;

  if (conversations.length === 0) {
    convBar.classList.add('hidden');
    convSelect.innerHTML = '';
    return;
  }

  convBar.classList.remove('hidden');
  convSelect.innerHTML = '';
  for (const conv of conversations) {
    const opt = document.createElement('option');
    opt.value = conv.conversationId;
    opt.textContent = conv.title || conv.conversationId;
    convSelect.appendChild(opt);
  }

  if (
    activeConversationId &&
    conversations.some((c) => c.conversationId === activeConversationId)
  ) {
    convSelect.value = activeConversationId;
  } else {
    convSelect.value = conversations[0]!.conversationId;
  }
}

function syncCumulativeVisibility(): void {
  const toggleBtn = document.getElementById('toggleCumulativeBtn');
  const totalEl = document.getElementById('cumulativeTotal');
  const detailsEl = document.getElementById('cumulativeDetails');
  if (!toggleBtn || !totalEl || !detailsEl) return;
  toggleBtn.setAttribute('aria-expanded', String(showCumulative));
  totalEl.classList.toggle('hidden', !showCumulative);
  detailsEl.classList.toggle('hidden', !showCumulative);
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

function renderBreakdown(breakdownEl: HTMLElement, t: ConversationTelemetry): void {
  const usageTotal = t.contextUsage > 0 ? t.contextUsage : 0;
  const segments = [
    { label: 'Cache Read', value: t.cacheRead, colorVar: 'var(--mma-chart-1)' },
    { label: 'Uncached Input', value: t.uncachedInput, colorVar: 'var(--mma-chart-2)' },
    { label: 'Output', value: t.output, colorVar: 'var(--mma-chart-3)' },
  ];
  const hitRateText = Number.isFinite(t.cacheHitRate) ? t.cacheHitRate.toFixed(1) : '0.0';

  const barHtml = segments
    .map((seg) => {
      const widthPct = usageTotal > 0 ? (seg.value / usageTotal) * 100 : 0;
      return `<div class="stacked-bar-seg" style="width:${widthPct}%; background: ${seg.colorVar};" title="${seg.label}"></div>`;
    })
    .join('');

  const rowsHtml = segments
    .map(
      (seg) => `
      <div class="breakdown-row">
        <span class="breakdown-label"><i class="legend-dot" style="background: ${seg.colorVar};" aria-hidden="true"></i>${seg.label}</span>
        <span class="breakdown-value tabular-nums">${formatFull(seg.value)}</span>
      </div>`,
    )
    .join('');

  breakdownEl.classList.remove('hidden');
  breakdownEl.innerHTML = `
    <div class="section-header">
      <span class="section-title">Token 結構分解</span>
      <span class="cache-hit-rate tabular-nums">緩存命中率 <strong class="tabular-nums">${hitRateText}%</strong></span>
    </div>
    <div class="stacked-bar-track" aria-label="Token 結構分佈">${barHtml}</div>
    <div class="breakdown-list tabular-nums">${rowsHtml}</div>
  `;
}

function renderCumulative(
  cumulativeEl: HTMLElement,
  cumulativeTotalEl: HTMLElement,
  cumulativeDetailsEl: HTMLElement,
  t: ConversationTelemetry,
): void {
  const { uncachedInput, cacheRead, output, total } = t.cumulative;
  cumulativeEl.classList.remove('hidden');
  cumulativeTotalEl.textContent = `${formatCompact(total)} tokens`;
  cumulativeDetailsEl.innerHTML = `
    <span>輸入 ${formatCompact(uncachedInput)}</span>
    <span>緩存 ${formatCompact(cacheRead)}</span>
    <span>輸出 ${formatCompact(output)}</span>
  `;
  syncCumulativeVisibility();
}

function setConfirmBarOpen(open: boolean): void {
  confirmingCompact = open;
  const confirmBar = document.getElementById('confirmBar');
  const compactBtn = document.getElementById('compactBtn');
  if (confirmBar) {
    confirmBar.classList.toggle('hidden', !open);
  }
  if (compactBtn) {
    compactBtn.setAttribute('aria-expanded', String(open));
  }
}

function clearToastTimer(): void {
  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId);
    toastTimerId = null;
  }
}

function showToast(message: string): void {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearToastTimer();
  toastTimerId = window.setTimeout(() => {
    toastEl.classList.add('hidden');
    toastTimerId = null;
  }, TOAST_DURATION_MS);
}

async function handleConfirmCompact(): Promise<void> {
  setConfirmBarOpen(false);
  if (!hostSupportsMessage || !appInstance || isSendingCompact) return;

  isSendingCompact = true;
  try {
    const result = await appInstance.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: '/compact' }],
    });
    if (result?.isError) {
      showToast('發送 /compact 失敗');
    } else {
      showToast('已發送 /compact 壓縮指令');
    }
  } catch (err) {
    console.error('[mon-my-agy] Failed to send /compact message:', err);
    showToast('發送 /compact 失敗');
  } finally {
    isSendingCompact = false;
  }
}

function syncCompactAvailability(): void {
  const compactBtn = document.getElementById('compactBtn') as HTMLButtonElement | null;
  if (compactBtn) {
    compactBtn.classList.toggle('hidden', !hostSupportsMessage);
    compactBtn.disabled = !hostSupportsMessage || !hasActiveTelemetry;
  }
  if (!hostSupportsMessage || !hasActiveTelemetry) {
    setConfirmBarOpen(false);
  }
}

function applyMessageCapability(supported: boolean): void {
  hostSupportsMessage = supported;
  syncCompactAvailability();
}

function syncCompactButton(
  status: StatusLevel,
  fillPct: number,
  activeTelemetry: boolean,
): void {
  hasActiveTelemetry = activeTelemetry;
  const compactBtn = document.getElementById('compactBtn') as HTMLButtonElement | null;
  const compactFill = document.getElementById('compactFill') as HTMLElement | null;
  if (compactBtn && compactFill) {
    compactBtn.setAttribute('data-status', status);
    compactFill.style.width = `${fillPct}%`;
  }
  syncCompactAvailability();
}

function renderSnapshot(snapshot: TelemetrySnapshot | null): void {
  const dotEl = document.getElementById('headerDot');
  const modelEl = document.getElementById('modelBadge');
  const primaryEl = document.getElementById('modPrimary');
  const breakdownEl = document.getElementById('modBreakdown');
  const cumulativeEl = document.getElementById('modCumulative');
  const cumulativeTotalEl = document.getElementById('cumulativeTotal');
  const cumulativeDetailsEl = document.getElementById('cumulativeDetails');
  if (
    !dotEl ||
    !modelEl ||
    !primaryEl ||
    !breakdownEl ||
    !cumulativeEl ||
    !cumulativeTotalEl ||
    !cumulativeDetailsEl
  ) {
    return;
  }

  renderConversationSwitcher(
    snapshot?.conversations ?? [],
    snapshot?.activeConversationId ?? null,
  );

  if (!snapshot || !snapshot.telemetry || snapshot.statusLevel === 'empty') {
    dotEl.setAttribute('data-status', 'empty');
    modelEl.textContent = 'waiting';
    modelEl.setAttribute('title', 'waiting');
    syncCompactButton('empty', 0, false);
    primaryEl.innerHTML = `<div class="empty-state">${EMPTY_GUIDANCE}</div>`;
    breakdownEl.classList.add('hidden');
    breakdownEl.innerHTML = '';
    cumulativeEl.classList.add('hidden');
    cumulativeTotalEl.textContent = '';
    cumulativeDetailsEl.innerHTML = '';
    return;
  }

  const t = snapshot.telemetry;
  const status = snapshot.statusLevel;
  const pct = t.utilizationPct;
  const hasLimit = t.limit !== null && pct !== null;
  const barWidth = hasLimit ? Math.min(100, Math.max(0, pct)) : 0;
  const { label: statusLabel, barColor } = STATUS_META[status];
  const statusClass = `status-${status}`;

  dotEl.setAttribute('data-status', status);
  modelEl.textContent = t.model;
  modelEl.setAttribute('title', t.model);
  syncCompactButton(status, hasLimit ? barWidth : 0, true);

  const usageSummary = hasLimit
    ? `${formatFull(t.contextUsage)} / ${formatFull(t.limit!)} (${pct!.toFixed(1)}%)`
    : `${formatFull(t.contextUsage)} TOKENS (LIMIT_UNKNOWN)`;

  const remainingText =
    hasLimit && t.remainingTokens !== null
      ? `FREE: ${formatFull(t.remainingTokens)}`
      : 'CFG: config.json';

  primaryEl.innerHTML = `
    <div class="primary-metrics">
      <div class="metrics-row">
        <span class="metrics-label">CTX_WINDOW</span>
        <span class="metrics-value tabular-nums ${statusClass}">${usageSummary}</span>
      </div>
      <div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hasLimit ? Math.round(barWidth) : 0}">
        <div class="bar-fill" style="width:${barWidth}%; background:${barColor};"></div>
      </div>
      <div class="metrics-meta tabular-nums">
        <span>STATUS: <strong class="${statusClass}">${statusLabel}</strong></span>
        <span class="tabular-nums">${remainingText}</span>
      </div>
    </div>
  `;

  renderBreakdown(breakdownEl, t);
  renderCumulative(cumulativeEl, cumulativeTotalEl, cumulativeDetailsEl, t);
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

async function requestSnapshot(
  conversationId?: string,
  queueIfBusy = false,
): Promise<void> {
  if (!appInstance) return;
  if (isFetching) {
    if (queueIfBusy) {
      pendingRequest = { conversationId };
    }
    return;
  }

  isFetching = true;
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn?.setAttribute('aria-busy', 'true');

  try {
    const args: Record<string, unknown> = conversationId ? { conversationId } : {};
    const result = await appInstance.callServerTool({
      name: APP_QUERY_TOOL_NAME,
      arguments: args,
    });
    const snapshot = extractSnapshot(result.structuredContent);
    // Avoid overwriting the UI with a stale response when a newer user request is queued
    if (snapshot && pendingRequest === null) {
      renderSnapshot(snapshot);
    }
  } catch (err) {
    console.error('[mon-my-agy] Failed to fetch telemetry snapshot:', err);
  } finally {
    isFetching = false;
    refreshBtn?.removeAttribute('aria-busy');

    if (pendingRequest !== null) {
      const nextRequest = pendingRequest;
      pendingRequest = null;
      void requestSnapshot(nextRequest.conversationId, false);
    }
  }
}

function startPolling(): void {
  if (document.hidden || pollTimerId !== null) return;
  pollTimerId = window.setInterval(() => {
    if (!document.hidden) {
      void requestSnapshot(selectedConversationId, false);
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimerId !== null) {
    window.clearInterval(pollTimerId);
    pollTimerId = null;
  }
}

function syncPollingState(): void {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
  }
}

async function bootstrap(): Promise<void> {
  const toggleCumulativeBtn = document.getElementById('toggleCumulativeBtn');
  if (toggleCumulativeBtn) {
    toggleCumulativeBtn.addEventListener('click', () => {
      showCumulative = !showCumulative;
      syncCumulativeVisibility();
    });
  }

  const compactBtn = document.getElementById('compactBtn') as HTMLButtonElement | null;
  if (compactBtn) {
    compactBtn.addEventListener('click', () => {
      if (!hostSupportsMessage || compactBtn.disabled || !hasActiveTelemetry) return;
      setConfirmBarOpen(!confirmingCompact);
    });
  }

  const cancelCompactBtn = document.getElementById('cancelCompactBtn');
  if (cancelCompactBtn) {
    cancelCompactBtn.addEventListener('click', () => {
      setConfirmBarOpen(false);
    });
  }

  const confirmCompactBtn = document.getElementById('confirmCompactBtn');
  if (confirmCompactBtn) {
    confirmCompactBtn.addEventListener('click', () => {
      void handleConfirmCompact();
    });
  }

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void requestSnapshot(selectedConversationId, true);
    });
  }

  const convSelect = document.getElementById('convSelect') as HTMLSelectElement | null;
  if (convSelect) {
    convSelect.addEventListener('change', () => {
      setConfirmBarOpen(false);
      selectedConversationId = convSelect.value || undefined;
      void requestSnapshot(selectedConversationId, true);
    });
  }

  const app = new App({ name: 'Mon-My-Agy', version: '0.1.0' }, {});
  appInstance = app;

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
    applyMessageCapability(Boolean(app.getHostCapabilities()?.message));

    document.addEventListener('visibilitychange', syncPollingState);
    window.addEventListener('pagehide', () => {
      stopPolling();
      clearToastTimer();
    });
    syncPollingState();
  } catch (err) {
    console.error('[mon-my-agy] Failed to connect MCP App:', err);
  }
}

void bootstrap();
