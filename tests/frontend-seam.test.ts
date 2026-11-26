import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { APP_QUERY_TOOL_NAME, type TelemetrySnapshot } from '../src/shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builtHtmlPath = path.resolve(__dirname, '../dist/app.html');

interface ToolCallRecord {
  name: string;
  arguments?: Record<string, unknown>;
}

interface SentMessageRecord {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface MountOptions {
  initialHidden?: boolean;
  hostCapabilities?: Record<string, unknown>;
  onToolCall?: (
    call: ToolCallRecord,
  ) => TelemetrySnapshot | Promise<TelemetrySnapshot>;
}

interface MountedApp {
  dom: JSDOM;
  toolCalls: ToolCallRecord[];
  sentMessages: SentMessageRecord[];
  sendToolResult: (snapshot: TelemetrySnapshot) => Promise<void>;
  setHidden: (hidden: boolean) => void;
  advanceIntervals: () => Promise<void>;
  activeIntervalCount: () => number;
  close: () => void;
}

async function mountBuiltApp(options: MountOptions = {}): Promise<MountedApp> {
  const html = await fs.readFile(builtHtmlPath, 'utf8');

  let resolveInitialized!: () => void;
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });

  const toolCalls: ToolCallRecord[] = [];
  const sentMessages: SentMessageRecord[] = [];
  let hiddenState = options.initialHidden ?? false;
  let nextIntervalId = 1;
  const activeIntervals = new Map<number, () => void>();

  const dom = new JSDOM(html, {
    url: 'https://mon-my-agy.mcp-app.local/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      // Polyfill ResizeObserver for @modelcontextprotocol/ext-apps autoResize
      (win as unknown as Record<string, unknown>).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

      // Controllable document visibility for testing visible-only polling
      Object.defineProperty(win.document, 'hidden', {
        get: () => hiddenState,
        configurable: true,
      });
      Object.defineProperty(win.document, 'visibilityState', {
        get: () => (hiddenState ? 'hidden' : 'visible'),
        configurable: true,
      });

      // Deterministic interval harness (captures window.setInterval/clearInterval without real waits)
      win.setInterval = ((handler: TimerHandler) => {
        const id = nextIntervalId++;
        if (typeof handler === 'function') {
          activeIntervals.set(id, handler as () => void);
        }
        return id;
      }) as unknown as typeof win.setInterval;

      win.clearInterval = ((id?: number) => {
        if (typeof id === 'number') {
          activeIntervals.delete(id);
        }
      }) as unknown as typeof win.clearInterval;

      const hostParent = {
        postMessage(message: unknown) {
          const msg = message as {
            jsonrpc?: string;
            id?: number | string;
            method?: string;
            params?: Record<string, unknown>;
          };
          if (!msg || msg.jsonrpc !== '2.0') return;

          if (msg.method === 'ui/initialize' && msg.id !== undefined) {
            const protocolVersion =
              typeof msg.params?.protocolVersion === 'string'
                ? msg.params.protocolVersion
                : '2026-01-26';
            queueMicrotask(() => {
              win.dispatchEvent(
                new win.MessageEvent('message', {
                  data: {
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: {
                      protocolVersion,
                      hostInfo: { name: 'antigravity-test-host', version: '1.0.0' },
                      hostCapabilities: options.hostCapabilities ?? {
                        serverTools: {},
                        message: {},
                      },
                      hostContext: {
                        theme: 'dark',
                        displayMode: 'inline',
                        styles: {
                          variables: {
                            '--color-background-primary': '#14171d',
                            '--color-background-secondary': '#1c2028',
                            '--color-text-primary': '#f3f4f6',
                            '--color-text-secondary': '#a1a8b5',
                            '--color-border-primary': '#323946',
                          },
                        },
                      },
                    },
                  },
                  source: hostParent as unknown as Window,
                }),
              );
            });
          } else if (msg.method === 'ui/notifications/initialized') {
            resolveInitialized();
          } else if (msg.method === 'tools/call' && msg.id !== undefined) {
            const record: ToolCallRecord = {
              name: String(msg.params?.name ?? ''),
              arguments: msg.params?.arguments as Record<string, unknown> | undefined,
            };
            toolCalls.push(record);
            const requestId = msg.id;
            const respond = (snapshot: TelemetrySnapshot) => {
              win.dispatchEvent(
                new win.MessageEvent('message', {
                  data: {
                    jsonrpc: '2.0',
                    id: requestId,
                    result: {
                      content: [{ type: 'text', text: 'snapshot' }],
                      structuredContent: snapshot,
                    },
                  },
                  source: hostParent as unknown as Window,
                }),
              );
            };
            if (options.onToolCall) {
              Promise.resolve(options.onToolCall(record)).then(respond);
            } else {
              queueMicrotask(() =>
                respond({
                  activeConversationId: null,
                  conversations: [],
                  telemetry: null,
                  statusLevel: 'empty',
                }),
              );
            }
          } else if (msg.method === 'ui/message' && msg.id !== undefined) {
            const record: SentMessageRecord = {
              role: typeof msg.params?.role === 'string' ? msg.params.role : undefined,
              content: Array.isArray(msg.params?.content)
                ? (msg.params.content as Array<{ type?: string; text?: string }>)
                : undefined,
            };
            sentMessages.push(record);
            const requestId = msg.id;
            queueMicrotask(() => {
              win.dispatchEvent(
                new win.MessageEvent('message', {
                  data: {
                    jsonrpc: '2.0',
                    id: requestId,
                    result: {},
                  },
                  source: hostParent as unknown as Window,
                }),
              );
            });
          }
        },
      };

      Object.defineProperty(win, 'parent', {
        value: hostParent,
        configurable: true,
      });
    },
  });

  await initialized;
  // Allow post-connect microtasks (e.g., starting visibility-aware polling) to settle
  await new Promise((r) => setTimeout(r, 10));

  return {
    dom,
    toolCalls,
    sentMessages,
    async sendToolResult(snapshot: TelemetrySnapshot) {
      const win = dom.window;
      win.dispatchEvent(
        new win.MessageEvent('message', {
          data: {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              content: [{ type: 'text', text: 'snapshot' }],
              structuredContent: snapshot,
            },
          },
          source: win.parent as unknown as Window,
        }),
      );
      await new Promise((r) => setTimeout(r, 10));
    },
    setHidden(hidden: boolean) {
      hiddenState = hidden;
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    },
    async advanceIntervals() {
      for (const cb of [...activeIntervals.values()]) {
        cb();
      }
      await new Promise((r) => setTimeout(r, 15));
    },
    activeIntervalCount() {
      return activeIntervals.size;
    },
    close() {
      activeIntervals.clear();
      dom.window.close();
    },
  };
}

describe('Frontend Seam: Single-File MCP App HTML <-> postMessage Host Bridge', () => {
  const openApps: MountedApp[] = [];

  afterEach(() => {
    while (openApps.length > 0) {
      openApps.pop()?.close();
    }
  });

  it('ships as a self-contained single HTML file with zero external script or stylesheet dependencies', async () => {
    const html = await fs.readFile(builtHtmlPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
    expect(html).toContain('font-variant-numeric: tabular-nums');
  });

  it('renders clear empty state when no conversations are indexed', async () => {
    const app = await mountBuiltApp();
    openApps.push(app);

    await app.sendToolResult({
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
    });

    const doc = app.dom.window.document;
    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('empty');
    expect(doc.getElementById('modelBadge')?.textContent?.trim()).toBe('waiting');
    expect(doc.getElementById('modPrimary')?.textContent).toContain('尚無已記錄的對話數據');
    expect(doc.getElementById('modPrimary')?.textContent).not.toContain('CTX_WINDOW');
    expect(doc.getElementById('modBreakdown')?.classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('modCumulative')?.classList.contains('hidden')).toBe(true);
  });

  it('renders normal (<70%), warning (70%-84.9%), and critical (>=85%) Context Usage states with tabular-nums', async () => {
    const app = await mountBuiltApp();
    openApps.push(app);
    const doc = app.dom.window.document;

    // 1. Normal state (~21.3%)
    await app.sendToolResult({
      activeConversationId: 'conv-1',
      conversations: [
        {
          conversationId: 'conv-1',
          modelName: 'gemini-4-neon-medium',
          title: 'Normal Session',
          lastActiveAt: '2026-11-26T04:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10649,
        cacheRead: 31339,
        output: 627,
        contextUsage: 42615,
        utilizationPct: 21.3075,
        remainingTokens: 157385,
        cacheHitRate: 74.638,
        cumulative: { uncachedInput: 52410, cacheRead: 98120, output: 4820, total: 155350 },
      },
      statusLevel: 'normal',
    });

    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('normal');
    expect(doc.getElementById('modelBadge')?.textContent?.trim()).toBe('gemini-4-neon-medium');
    const primaryTextNormal = doc.getElementById('modPrimary')?.textContent ?? '';
    expect(primaryTextNormal).toContain('CTX_WINDOW');
    expect(primaryTextNormal).toContain('42,615 / 200,000 (21.3%)');
    expect(primaryTextNormal).toContain('健康水位');
    expect(primaryTextNormal).toContain('FREE: 157,385');
    expect(doc.querySelectorAll('.tabular-nums').length).toBeGreaterThan(0);

    // 2. Warning state (78.0%)
    await app.sendToolResult({
      activeConversationId: 'conv-2',
      conversations: [],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 24800,
        cacheRead: 128400,
        output: 2800,
        contextUsage: 156000,
        utilizationPct: 78.0,
        remainingTokens: 44000,
        cacheHitRate: 83.812,
        cumulative: { uncachedInput: 164200, cacheRead: 512000, output: 19400, total: 695600 },
      },
      statusLevel: 'warning',
    });

    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('warning');
    const primaryTextWarn = doc.getElementById('modPrimary')?.textContent ?? '';
    expect(primaryTextWarn).toContain('156,000 / 200,000 (78.0%)');
    expect(primaryTextWarn).toContain('預警水位');
    expect(primaryTextWarn).toContain('FREE: 44,000');

    // 3. Critical state (93.0%)
    await app.sendToolResult({
      activeConversationId: 'conv-3',
      conversations: [],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 18500,
        cacheRead: 164200,
        output: 3300,
        contextUsage: 186000,
        utilizationPct: 93.0,
        remainingTokens: 14000,
        cacheHitRate: 89.8741,
        cumulative: { uncachedInput: 215000, cacheRead: 842000, output: 28600, total: 1085600 },
      },
      statusLevel: 'critical',
    });

    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('critical');
    const primaryTextCrit = doc.getElementById('modPrimary')?.textContent ?? '';
    expect(primaryTextCrit).toContain('186,000 / 200,000 (93.0%)');
    expect(primaryTextCrit).toContain('危險水位');
    expect(primaryTextCrit).toContain('FREE: 14,000');
  });

  it('renders Module 2 Token Breakdown with Cache Hit Rate, 3-segment stacked bar, comma-formatted rows, and zero-input boundary', async () => {
    const app = await mountBuiltApp();
    openApps.push(app);
    const doc = app.dom.window.document;

    await app.sendToolResult({
      activeConversationId: 'conv-breakdown',
      conversations: [
        {
          conversationId: 'conv-breakdown',
          modelName: 'gemini-4-neon-medium',
          title: 'Breakdown Session',
          lastActiveAt: '2026-11-26T04:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10649,
        cacheRead: 31339,
        output: 627,
        contextUsage: 42615,
        utilizationPct: 21.3075,
        remainingTokens: 157385,
        cacheHitRate: 74.638,
        cumulative: { uncachedInput: 52410, cacheRead: 98120, output: 4820, total: 155350 },
      },
      statusLevel: 'normal',
    });

    const breakdownEl = doc.getElementById('modBreakdown');
    expect(breakdownEl).not.toBeNull();
    expect(breakdownEl?.classList.contains('hidden')).toBe(false);

    const text = breakdownEl?.textContent ?? '';
    expect(text).toContain('Token 結構分解');
    expect(text).toContain('緩存命中率');
    expect(text).toContain('74.6%');
    expect(text).toContain('Cache Read');
    expect(text).toContain('31,339');
    expect(text).toContain('Uncached Input');
    expect(text).toContain('10,649');
    expect(text).toContain('Output');
    expect(text).toContain('627');
    expect(breakdownEl?.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(4);

    const cacheSeg = breakdownEl?.querySelector<HTMLElement>('[title="Cache Read"]');
    const inputSeg = breakdownEl?.querySelector<HTMLElement>('[title="Uncached Input"]');
    const outputSeg = breakdownEl?.querySelector<HTMLElement>('[title="Output"]');
    expect(parseFloat(cacheSeg?.style.width ?? '0')).toBeCloseTo(73.54, 1);
    expect(parseFloat(inputSeg?.style.width ?? '0')).toBeCloseTo(24.99, 1);
    expect(parseFloat(outputSeg?.style.width ?? '0')).toBeCloseTo(1.47, 1);

    // Zero-input and zero-usage boundary (must render 0.0% and 0% widths without NaN)
    await app.sendToolResult({
      activeConversationId: 'conv-zero',
      conversations: [],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 0,
        cacheRead: 0,
        output: 0,
        contextUsage: 0,
        utilizationPct: 0,
        remainingTokens: 200000,
        cacheHitRate: 0,
        cumulative: { uncachedInput: 0, cacheRead: 0, output: 0, total: 0 },
      },
      statusLevel: 'normal',
    });

    expect(breakdownEl?.textContent).toContain('0.0%');
    expect(breakdownEl?.querySelector<HTMLElement>('[title="Cache Read"]')?.style.width).toBe('0%');
    expect(breakdownEl?.querySelector<HTMLElement>('[title="Uncached Input"]')?.style.width).toBe('0%');
    expect(breakdownEl?.querySelector<HTMLElement>('[title="Output"]')?.style.width).toBe('0%');

    // Empty state hides Module 2
    await app.sendToolResult({
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
    });
    expect(breakdownEl?.classList.contains('hidden')).toBe(true);
  });

  it('renders Module 3 Cumulative Usage in compact k-format and toggles visibility on click while preserving state across updates', async () => {
    const app = await mountBuiltApp();
    openApps.push(app);
    const doc = app.dom.window.document;

    await app.sendToolResult({
      activeConversationId: 'conv-cum',
      conversations: [
        {
          conversationId: 'conv-cum',
          modelName: 'gemini-4-neon-medium',
          title: 'Cumulative Session',
          lastActiveAt: '2026-11-26T04:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10649,
        cacheRead: 31339,
        output: 627,
        contextUsage: 42615,
        utilizationPct: 21.3075,
        remainingTokens: 157385,
        cacheHitRate: 74.638,
        cumulative: { uncachedInput: 52410, cacheRead: 98120, output: 850, total: 151380 },
      },
      statusLevel: 'normal',
    });

    const cumulativeEl = doc.getElementById('modCumulative');
    expect(cumulativeEl).not.toBeNull();
    expect(cumulativeEl?.classList.contains('hidden')).toBe(false);

    const toggleBtn = doc.getElementById('toggleCumulativeBtn') as HTMLButtonElement | null;
    const detailsEl = doc.getElementById('cumulativeDetails');
    expect(toggleBtn).not.toBeNull();
    expect(detailsEl).not.toBeNull();
    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(detailsEl?.classList.contains('hidden')).toBe(false);

    const text = cumulativeEl?.textContent ?? '';
    expect(text).toContain('會話累計消耗');
    expect(text).toContain('151.4k tokens');
    expect(text).toContain('輸入 52.4k');
    expect(text).toContain('緩存 98.1k');
    expect(text).toContain('輸出 850');
    expect(cumulativeEl?.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(2);

    // Click toggle button to collapse
    toggleBtn?.click();
    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(detailsEl?.classList.contains('hidden')).toBe(true);

    // Subsequent snapshot update preserves collapsed state
    await app.sendToolResult({
      activeConversationId: 'conv-cum',
      conversations: [],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 12000,
        cacheRead: 40000,
        output: 1000,
        contextUsage: 53000,
        utilizationPct: 26.5,
        remainingTokens: 147000,
        cacheHitRate: 76.923,
        cumulative: { uncachedInput: 64410, cacheRead: 138120, output: 1850, total: 204380 },
      },
      statusLevel: 'normal',
    });

    expect(doc.getElementById('toggleCumulativeBtn')?.getAttribute('aria-expanded')).toBe('false');
    expect(doc.getElementById('cumulativeDetails')?.classList.contains('hidden')).toBe(true);

    // Click toggle button to expand again and verify updated totals
    (doc.getElementById('toggleCumulativeBtn') as HTMLButtonElement | null)?.click();
    expect(doc.getElementById('toggleCumulativeBtn')?.getAttribute('aria-expanded')).toBe('true');
    expect(doc.getElementById('cumulativeDetails')?.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('modCumulative')?.textContent).toContain('204.4k tokens');

    // Empty state hides Module 3 completely
    await app.sendToolResult({
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
    });
    expect(cumulativeEl?.classList.contains('hidden')).toBe(true);
  });

  it('gracefully degrades when Context Window Limit is unknown (limit: null)', async () => {
    const app = await mountBuiltApp();
    openApps.push(app);
    const doc = app.dom.window.document;

    await app.sendToolResult({
      activeConversationId: 'conv-unknown',
      conversations: [
        {
          conversationId: 'conv-unknown',
          modelName: 'gemini-next-exp-05',
          title: 'Unknown Model Session',
          lastActiveAt: '2026-11-26T04:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-next-exp-05',
        limit: null,
        uncachedInput: 14200,
        cacheRead: 48600,
        output: 1120,
        contextUsage: 63920,
        utilizationPct: null,
        remainingTokens: null,
        cacheHitRate: 77.3885,
        cumulative: { uncachedInput: 68400, cacheRead: 145000, output: 7210, total: 220610 },
      },
      statusLevel: 'unknown',
    });

    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('unknown');
    expect(doc.getElementById('modelBadge')?.textContent?.trim()).toBe('gemini-next-exp-05');

    const primaryEl = doc.getElementById('modPrimary');
    const primaryText = primaryEl?.textContent ?? '';
    expect(primaryText).toContain('CTX_WINDOW');
    expect(primaryText).toContain('63,920 TOKENS (LIMIT_UNKNOWN)');
    expect(primaryText).toContain('上限未知');
    expect(primaryText).toContain('CFG: config.json');
    expect(primaryText).not.toContain('%');
    expect(primaryText).not.toContain('FREE:');
    expect(primaryText).not.toContain('-');

    const progressBar = primaryEl?.querySelector<HTMLElement>('[role="progressbar"]');
    const barFill = primaryEl?.querySelector<HTMLElement>('.bar-fill');
    expect(progressBar?.getAttribute('aria-valuenow')).toBe('0');
    expect(barFill?.style.width).toBe('0%');

    // Modules 2 and 3 remain visible with accurate breakdown & cumulative usage
    expect(doc.getElementById('modBreakdown')?.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('modBreakdown')?.textContent).toContain('77.4%');
    expect(doc.getElementById('modCumulative')?.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('modCumulative')?.textContent).toContain('220.6k tokens');
  });

  it('triggers app-only query tool on manual Refresh button click and updates view', async () => {
    const refreshedSnapshot: TelemetrySnapshot = {
      activeConversationId: 'conv-refreshed',
      conversations: [
        {
          conversationId: 'conv-refreshed',
          modelName: 'gemini-4-neon-medium',
          title: 'Refreshed Session',
          lastActiveAt: '2026-11-26T05:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 20000,
        cacheRead: 80000,
        output: 2000,
        contextUsage: 102000,
        utilizationPct: 51.0,
        remainingTokens: 98000,
        cacheHitRate: 80.0,
        cumulative: { uncachedInput: 30000, cacheRead: 120000, output: 4000, total: 154000 },
      },
      statusLevel: 'normal',
    };

    const app = await mountBuiltApp({
      onToolCall: () => refreshedSnapshot,
    });
    openApps.push(app);
    const doc = app.dom.window.document;

    const refreshBtn = doc.getElementById('refreshBtn') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    expect(refreshBtn?.getAttribute('title')).toBe('Refresh');
    expect(refreshBtn?.getAttribute('aria-label')).toBe('Refresh');
    expect(refreshBtn?.querySelector('svg')).not.toBeNull();

    refreshBtn?.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(app.toolCalls).toEqual([{ name: APP_QUERY_TOOL_NAME, arguments: {} }]);
    expect(doc.getElementById('modPrimary')?.textContent).toContain('102,000 / 200,000 (51.0%)');
    expect(doc.getElementById('modBreakdown')?.textContent).toContain('80.0%');
  });

  it('hides conversation switcher in empty state and switches conversation via app-only query tool', async () => {
    const conversations = [
      {
        conversationId: 'conv-latest',
        modelName: 'gemini-4-neon-medium',
        title: 'Latest Coding Session',
        lastActiveAt: '2026-11-26T06:00:00Z',
      },
      {
        conversationId: 'conv-prev',
        modelName: 'claude-sonnet-4-20250514',
        title: 'Previous Review Session',
        lastActiveAt: '2026-11-26T05:00:00Z',
      },
    ];

    const prevSnapshot: TelemetrySnapshot = {
      activeConversationId: 'conv-prev',
      conversations,
      telemetry: {
        model: 'claude-sonnet-4-20250514',
        limit: 200000,
        uncachedInput: 30000,
        cacheRead: 120000,
        output: 6000,
        contextUsage: 156000,
        utilizationPct: 78.0,
        remainingTokens: 44000,
        cacheHitRate: 80.0,
        cumulative: { uncachedInput: 50000, cacheRead: 200000, output: 10000, total: 260000 },
      },
      statusLevel: 'warning',
    };

    const app = await mountBuiltApp({
      onToolCall: (call) => {
        if (call.arguments?.conversationId === 'conv-prev') {
          return prevSnapshot;
        }
        return {
          activeConversationId: 'conv-latest',
          conversations,
          telemetry: null,
          statusLevel: 'empty',
        };
      },
    });
    openApps.push(app);
    const doc = app.dom.window.document;

    // 1. Empty state hides conversation switcher
    await app.sendToolResult({
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
    });
    const convBar = doc.getElementById('convBar');
    const convSelect = doc.getElementById('convSelect') as HTMLSelectElement | null;
    expect(convBar?.classList.contains('hidden')).toBe(true);
    expect(convSelect).not.toBeNull();

    // 2. Populated state reveals switcher with options in server order
    await app.sendToolResult({
      activeConversationId: 'conv-latest',
      conversations,
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10000,
        cacheRead: 30000,
        output: 1000,
        contextUsage: 41000,
        utilizationPct: 20.5,
        remainingTokens: 159000,
        cacheHitRate: 75.0,
        cumulative: { uncachedInput: 10000, cacheRead: 30000, output: 1000, total: 41000 },
      },
      statusLevel: 'normal',
    });

    expect(convBar?.classList.contains('hidden')).toBe(false);
    expect(Array.from(convSelect!.options).map((o) => ({ value: o.value, text: o.textContent }))).toEqual([
      { value: 'conv-latest', text: 'Latest Coding Session' },
      { value: 'conv-prev', text: 'Previous Review Session' },
    ]);
    expect(convSelect!.value).toBe('conv-latest');

    // 3. Changing dropdown triggers callServerTool with selected conversationId and updates all modules
    convSelect!.value = 'conv-prev';
    convSelect!.dispatchEvent(new app.dom.window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));

    expect(app.toolCalls).toEqual([
      { name: APP_QUERY_TOOL_NAME, arguments: { conversationId: 'conv-prev' } },
    ]);
    expect(doc.getElementById('headerDot')?.getAttribute('data-status')).toBe('warning');
    expect(doc.getElementById('modelBadge')?.textContent?.trim()).toBe('claude-sonnet-4-20250514');
    expect(doc.getElementById('modPrimary')?.textContent).toContain('156,000 / 200,000 (78.0%)');
    expect(doc.getElementById('modCumulative')?.textContent).toContain('260.0k tokens');
  });

  it('polls only while page is visible and enforces single-in-flight request constraint', async () => {
    let resolveFirstPoll!: (snapshot: TelemetrySnapshot) => void;
    let pollCount = 0;

    const app = await mountBuiltApp({
      onToolCall: () => {
        pollCount += 1;
        if (pollCount === 1) {
          return new Promise<TelemetrySnapshot>((resolve) => {
            resolveFirstPoll = resolve;
          });
        }
        return {
          activeConversationId: 'conv-poll-2',
          conversations: [
            {
              conversationId: 'conv-poll-2',
              modelName: 'gemini-4-neon-medium',
              title: 'Polled Session',
              lastActiveAt: '2026-11-26T06:05:00Z',
            },
          ],
          telemetry: {
            model: 'gemini-4-neon-medium',
            limit: 200000,
            uncachedInput: 50000,
            cacheRead: 100000,
            output: 2000,
            contextUsage: 152000,
            utilizationPct: 76.0,
            remainingTokens: 48000,
            cacheHitRate: 66.666,
            cumulative: { uncachedInput: 50000, cacheRead: 100000, output: 2000, total: 152000 },
          },
          statusLevel: 'warning',
        };
      },
    });
    openApps.push(app);
    const doc = app.dom.window.document;

    // Visible on mount -> polling interval is active
    expect(app.activeIntervalCount()).toBe(1);

    // First poll tick sends 1 in-flight request
    await app.advanceIntervals();
    expect(app.toolCalls.length).toBe(1);
    expect(app.toolCalls[0]).toEqual({ name: APP_QUERY_TOOL_NAME, arguments: {} });

    // Subsequent ticks while first request is still unresolved MUST NOT fire concurrent requests
    await app.advanceIntervals();
    await app.advanceIntervals();
    expect(app.toolCalls.length).toBe(1);

    // Resolve first in-flight request -> view updates
    resolveFirstPoll({
      activeConversationId: 'conv-poll-1',
      conversations: [
        {
          conversationId: 'conv-poll-1',
          modelName: 'gemini-4-neon-medium',
          title: 'Polled Session',
          lastActiveAt: '2026-11-26T06:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10000,
        cacheRead: 40000,
        output: 1000,
        contextUsage: 51000,
        utilizationPct: 25.5,
        remainingTokens: 149000,
        cacheHitRate: 80.0,
        cumulative: { uncachedInput: 10000, cacheRead: 40000, output: 1000, total: 51000 },
      },
      statusLevel: 'normal',
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(doc.getElementById('modPrimary')?.textContent).toContain('51,000 / 200,000 (25.5%)');

    // Now that first request settled, next tick sends a new poll
    await app.advanceIntervals();
    expect(app.toolCalls.length).toBe(2);
    expect(doc.getElementById('modPrimary')?.textContent).toContain('152,000 / 200,000 (76.0%)');

    // Hiding the page stops polling immediately
    app.setHidden(true);
    expect(app.activeIntervalCount()).toBe(0);
    await app.advanceIntervals();
    expect(app.toolCalls.length).toBe(2);

    // Becoming visible again resumes polling
    app.setHidden(false);
    expect(app.activeIntervalCount()).toBe(1);
    await app.advanceIntervals();
    expect(app.toolCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('renders 56x28px liquid-fill /compact icon button synced with Context Usage percentage and status level', async () => {
    const html = await fs.readFile(builtHtmlPath, 'utf8');
    expect(html).toContain('width: 56px');
    expect(html).toContain('height: 28px');
    expect(html).toContain('color: var(--mma-muted)');
    expect(html).toContain('color: var(--mma-fg)');
    expect(html).toContain('.compact-btn[data-status="normal"] .compact-fill');
    expect(html).toContain('.compact-btn[data-status="warning"] .compact-fill');
    expect(html).toContain('.compact-btn[data-status="critical"] .compact-fill');

    const app = await mountBuiltApp();
    openApps.push(app);
    const doc = app.dom.window.document;

    const compactBtn = doc.getElementById('compactBtn') as HTMLButtonElement | null;
    const compactFill = doc.getElementById('compactFill') as HTMLElement | null;
    expect(compactBtn).not.toBeNull();
    expect(compactFill).not.toBeNull();
    expect(compactBtn?.getAttribute('title')).toBe('Compact');
    expect(compactBtn?.getAttribute('aria-label')).toBe('Compact');
    expect(compactBtn?.textContent?.trim()).toBe('');
    expect(compactBtn?.textContent).not.toContain('/compact');
    expect(compactBtn?.querySelector('svg')).not.toBeNull();

    // 1. Empty state -> 0% fill, disabled
    await app.sendToolResult({
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
    });
    expect(compactFill?.style.width).toBe('0%');
    expect(compactBtn?.getAttribute('data-status')).toBe('empty');
    expect(compactBtn?.disabled).toBe(true);

    // 2. Normal state (21.3%) -> synced fill width & normal status
    await app.sendToolResult({
      activeConversationId: 'conv-compact-1',
      conversations: [
        {
          conversationId: 'conv-compact-1',
          modelName: 'gemini-4-neon-medium',
          title: 'Compact Session',
          lastActiveAt: '2026-11-26T06:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10649,
        cacheRead: 31339,
        output: 627,
        contextUsage: 42615,
        utilizationPct: 21.3075,
        remainingTokens: 157385,
        cacheHitRate: 74.638,
        cumulative: { uncachedInput: 52410, cacheRead: 98120, output: 4820, total: 155350 },
      },
      statusLevel: 'normal',
    });
    expect(compactBtn?.disabled).toBe(false);
    expect(compactBtn?.getAttribute('data-status')).toBe('normal');
    expect(parseFloat(compactFill?.style.width ?? '0')).toBeCloseTo(21.3, 1);

    // 3. Critical state (93.0%) -> synced fill width & critical status
    await app.sendToolResult({
      activeConversationId: 'conv-compact-1',
      conversations: [
        {
          conversationId: 'conv-compact-1',
          modelName: 'gemini-4-neon-medium',
          title: 'Compact Session',
          lastActiveAt: '2026-11-26T06:05:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 18500,
        cacheRead: 164200,
        output: 3300,
        contextUsage: 186000,
        utilizationPct: 93.0,
        remainingTokens: 14000,
        cacheHitRate: 89.874,
        cumulative: { uncachedInput: 215000, cacheRead: 842000, output: 28600, total: 1085600 },
      },
      statusLevel: 'critical',
    });
    expect(compactBtn?.getAttribute('data-status')).toBe('critical');
    expect(parseFloat(compactFill?.style.width ?? '0')).toBeCloseTo(93.0, 1);

    // 4. Unknown model (limit: null) -> 0% fill, button still enabled for active conversation
    await app.sendToolResult({
      activeConversationId: 'conv-compact-unknown',
      conversations: [
        {
          conversationId: 'conv-compact-unknown',
          modelName: 'gemini-next-exp-05',
          title: 'Unknown Model Session',
          lastActiveAt: '2026-11-26T06:10:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-next-exp-05',
        limit: null,
        uncachedInput: 14200,
        cacheRead: 48600,
        output: 1120,
        contextUsage: 63920,
        utilizationPct: null,
        remainingTokens: null,
        cacheHitRate: 77.3885,
        cumulative: { uncachedInput: 68400, cacheRead: 145000, output: 7210, total: 220610 },
      },
      statusLevel: 'unknown',
    });
    expect(compactBtn?.disabled).toBe(false);
    expect(compactBtn?.getAttribute('data-status')).toBe('unknown');
    expect(compactFill?.style.width).toBe('0%');
  });

  it('toggles two-step inline confirmation, collapses on cancel or conversation switch without sending, and sends /compact with toast on confirm', async () => {
    const conversations = [
      {
        conversationId: 'conv-a',
        modelName: 'gemini-4-neon-medium',
        title: 'Session A',
        lastActiveAt: '2026-11-26T06:00:00Z',
      },
      {
        conversationId: 'conv-b',
        modelName: 'gemini-4-neon-medium',
        title: 'Session B',
        lastActiveAt: '2026-11-26T05:00:00Z',
      },
    ];

    const snapshotA: TelemetrySnapshot = {
      activeConversationId: 'conv-a',
      conversations,
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 30000,
        cacheRead: 130000,
        output: 4000,
        contextUsage: 164000,
        utilizationPct: 82.0,
        remainingTokens: 36000,
        cacheHitRate: 81.25,
        cumulative: { uncachedInput: 30000, cacheRead: 130000, output: 4000, total: 164000 },
      },
      statusLevel: 'warning',
    };

    const app = await mountBuiltApp({
      onToolCall: () => ({ ...snapshotA, activeConversationId: 'conv-b' }),
    });
    openApps.push(app);
    const doc = app.dom.window.document;

    await app.sendToolResult(snapshotA);

    const compactBtn = doc.getElementById('compactBtn') as HTMLButtonElement | null;
    const confirmBar = doc.getElementById('confirmBar') as HTMLElement | null;
    const cancelBtn = doc.getElementById('cancelCompactBtn') as HTMLButtonElement | null;
    const confirmBtn = doc.getElementById('confirmCompactBtn') as HTMLButtonElement | null;
    const toastEl = doc.getElementById('toast') as HTMLElement | null;
    const convSelect = doc.getElementById('convSelect') as HTMLSelectElement | null;

    expect(confirmBar).not.toBeNull();
    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(cancelBtn).not.toBeNull();
    expect(confirmBtn).not.toBeNull();
    expect(toastEl?.classList.contains('hidden')).toBe(true);

    // 1. Clicking /compact toggles inline confirmation bar open and closed
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(false);
    expect(app.sentMessages).toHaveLength(0);
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(app.sentMessages).toHaveLength(0);

    // 2. Re-open and click Cancel -> collapses bar and sends nothing
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(false);
    cancelBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(app.sentMessages).toHaveLength(0);

    // 3. Re-open confirmation bar, then switch conversation -> auto-collapses and sends nothing
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(false);
    convSelect!.value = 'conv-b';
    convSelect!.dispatchEvent(new app.dom.window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(app.sentMessages).toHaveLength(0);

    // 4. Re-open confirmation bar and click Confirm -> sends ui/message "/compact", collapses bar, shows toast
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(false);
    confirmBtn?.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(app.sentMessages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: '/compact' }],
      },
    ]);
    expect(toastEl?.classList.contains('hidden')).toBe(false);
    expect(toastEl?.textContent).toContain('/compact');
  });

  it('hides and disables /compact entry when host lacks message capability', async () => {
    const app = await mountBuiltApp({
      hostCapabilities: {
        serverTools: {},
      },
    });
    openApps.push(app);
    const doc = app.dom.window.document;

    await app.sendToolResult({
      activeConversationId: 'conv-no-msg',
      conversations: [
        {
          conversationId: 'conv-no-msg',
          modelName: 'gemini-4-neon-medium',
          title: 'Global View Session',
          lastActiveAt: '2026-11-26T06:00:00Z',
        },
      ],
      telemetry: {
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 40000,
        cacheRead: 130000,
        output: 4000,
        contextUsage: 174000,
        utilizationPct: 87.0,
        remainingTokens: 26000,
        cacheHitRate: 76.47,
        cumulative: { uncachedInput: 40000, cacheRead: 130000, output: 4000, total: 174000 },
      },
      statusLevel: 'critical',
    });

    const compactBtn = doc.getElementById('compactBtn') as HTMLButtonElement | null;
    const confirmBar = doc.getElementById('confirmBar') as HTMLElement | null;

    expect(compactBtn).not.toBeNull();
    expect(compactBtn?.classList.contains('hidden')).toBe(true);
    expect(compactBtn?.disabled).toBe(true);

    // Even if programmatically clicked, confirmation bar stays hidden and no message is sent
    compactBtn?.click();
    expect(confirmBar?.classList.contains('hidden')).toBe(true);
    expect(app.sentMessages).toHaveLength(0);
  });
});
