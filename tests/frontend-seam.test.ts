import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import type { TelemetrySnapshot } from '../src/shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builtHtmlPath = path.resolve(__dirname, '../dist/app.html');

interface MountedApp {
  dom: JSDOM;
  sendToolResult: (snapshot: TelemetrySnapshot) => Promise<void>;
  close: () => void;
}

async function mountBuiltApp(): Promise<MountedApp> {
  const html = await fs.readFile(builtHtmlPath, 'utf8');

  let resolveInitialized!: () => void;
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });

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
                      hostCapabilities: {
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

  return {
    dom,
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
    close() {
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
});
