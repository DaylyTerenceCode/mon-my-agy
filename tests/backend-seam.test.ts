import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { runHookIndexer } from '../src/hook/index-conversation.js';
import {
  createMcpServer,
  APP_RESOURCE_URI,
  ENTRYPOINT_TOOL_NAME,
  APP_QUERY_TOOL_NAME,
  APP_SAVE_COLORS_TOOL_NAME,
} from '../src/server/mcp-server.js';
import type { CustomColorPalette, TelemetrySnapshot } from '../src/shared/types.js';

const builtAppHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/app.html');

async function connectClient(dataDir: string) {
  const server = createMcpServer({
    dataDir,
    loadUiHtml: async () => fs.readFile(builtAppHtmlPath, 'utf8'),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('Backend Seam: Hook -> PLUGIN_DATA -> MCP Server', () => {
  let tmpDir: string;
  let pluginDataDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mon-my-agy-test-'));
    pluginDataDir = path.join(tmpDir, 'plugin-data');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes aux_pane entrypoint tool, MCP App UI resource, and returns empty state when no conversations are indexed', async () => {
    const { client, close } = await connectClient(pluginDataDir);
    try {
      const { tools } = await client.listTools();
      const entryTool = tools.find((t) => t.name === ENTRYPOINT_TOOL_NAME);
      expect(entryTool).toBeDefined();

      const meta = entryTool?._meta as Record<string, unknown> | undefined;
      expect((meta?.ui as Record<string, unknown> | undefined)?.resourceUri).toBe(APP_RESOURCE_URI);
      const agyUi = meta?.['com.google.antigravity/ui'] as { entrypoints?: Array<{ type: string; title?: string }> } | undefined;
      expect(agyUi?.entrypoints).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'aux_pane' })]),
      );

      const { resources } = await client.listResources();
      const uiRes = resources.find((r) => r.uri === APP_RESOURCE_URI);
      expect(uiRes).toBeDefined();
      expect(uiRes?.mimeType).toBe(RESOURCE_MIME_TYPE);

      const readRes = await client.readResource({ uri: APP_RESOURCE_URI });
      const firstContent = readRes.contents[0];
      expect(firstContent?.mimeType).toBe(RESOURCE_MIME_TYPE);
      const uiText = 'text' in firstContent! ? firstContent.text : '';
      expect(uiText).toContain('<!DOCTYPE html>');
      expect(uiText).not.toMatch(/<script[^>]+src=/i);

      const result = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      expect(result.isError).toBeFalsy();
      const contentBlocks = result.content as Array<{ type: string; text?: string }>;
      expect(Array.isArray(contentBlocks)).toBe(true);
      expect(contentBlocks.length).toBeGreaterThan(0);

      const snapshot = result.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.statusLevel).toBe('empty');
      expect(snapshot.telemetry).toBeNull();
      expect(snapshot.conversations).toEqual([]);
    } finally {
      await close();
    }
  });

  it('indexes a conversation via lifecycle hook and returns accurate Context Usage, Context Window Limit, and status level', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Hello' }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        model: 'gemini-4-neon-medium',
        input_tokens: 15000,
        cache_read_tokens: 0,
        output_tokens: 500,
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        model: 'gemini-4-neon-medium',
        input_tokens: 10649,
        cache_read_tokens: 31339,
        output_tokens: 627,
      }),
    ];
    await fs.writeFile(transcriptPath, lines.join('\n') + '\n', 'utf8');

    const startMs = performance.now();
    const hookResult = await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-normal-1',
        modelName: 'gemini-4-neon-medium',
        transcriptPath,
        lastUserInput: 'Implement ticket 01',
        hookEventName: 'PostInvocation',
      }),
      pluginDataDir,
    );
    const elapsedMs = performance.now() - startMs;

    expect(hookResult.exitCode).toBe(0);
    expect(hookResult.stdout).toBe('{}');
    expect(elapsedMs).toBeLessThan(50);

    const { client, close } = await connectClient(pluginDataDir);
    try {
      const result = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const snapshot = result.structuredContent as unknown as TelemetrySnapshot;

      expect(snapshot.activeConversationId).toBe('conv-normal-1');
      expect(snapshot.statusLevel).toBe('normal');
      expect(snapshot.telemetry).toEqual({
        model: 'gemini-4-neon-medium',
        limit: 200000,
        uncachedInput: 10649,
        cacheRead: 31339,
        output: 627,
        contextUsage: 42615,
        utilizationPct: expect.closeTo(21.3075, 4),
        remainingTokens: 157385,
        cacheHitRate: expect.closeTo(74.638, 3),
        cumulative: {
          uncachedInput: 25649,
          cacheRead: 31339,
          output: 1127,
          total: 58115,
        },
      });
    } finally {
      await close();
    }
  });

  it('classifies warning (70%-84.9%) and critical (>=85%) Context Usage status levels', async () => {
    const warningTranscript = path.join(tmpDir, 'warning.jsonl');
    await fs.writeFile(
      warningTranscript,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        model: 'gemini-4-neon-medium',
        input_tokens: 24800,
        cache_read_tokens: 128400,
        output_tokens: 2800,
      }) + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-warn',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: warningTranscript,
      }),
      pluginDataDir,
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      let res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      let snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.statusLevel).toBe('warning');
      expect(snapshot.telemetry?.contextUsage).toBe(156000);
      expect(snapshot.telemetry?.remainingTokens).toBe(44000);

      const criticalTranscript = path.join(tmpDir, 'critical.jsonl');
      await fs.writeFile(
        criticalTranscript,
        JSON.stringify({
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          model: 'gemini-4-neon-medium',
          input_tokens: 18500,
          cache_read_tokens: 164200,
          output_tokens: 3300,
        }) + '\n',
        'utf8',
      );
      await runHookIndexer(
        JSON.stringify({
          conversationId: 'conv-crit',
          modelName: 'gemini-4-neon-medium',
          transcriptPath: criticalTranscript,
        }),
        pluginDataDir,
      );

      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.activeConversationId).toBe('conv-crit');
      expect(snapshot.statusLevel).toBe('critical');
      expect(snapshot.telemetry?.contextUsage).toBe(186000);
      expect(snapshot.telemetry?.remainingTokens).toBe(14000);
    } finally {
      await close();
    }
  });

  it('returns 0% Cache Hit Rate when total input tokens are zero and aggregates Cumulative Usage across invocations', async () => {
    const zeroInputTranscript = path.join(tmpDir, 'zero-input.jsonl');
    await fs.writeFile(
      zeroInputTranscript,
      [
        JSON.stringify({
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          model: 'gemini-4-neon-medium',
          input_tokens: 1000,
          cache_read_tokens: 3000,
          output_tokens: 400,
        }),
        JSON.stringify({
          step_index: 2,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          model: 'gemini-4-neon-medium',
          input_tokens: 0,
          cache_read_tokens: 0,
          output_tokens: 250,
        }),
      ].join('\n') + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-zero-input',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: zeroInputTranscript,
      }),
      pluginDataDir,
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      const res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const snapshot = res.structuredContent as unknown as TelemetrySnapshot;

      expect(snapshot.telemetry?.cacheHitRate).toBe(0);
      expect(snapshot.telemetry?.contextUsage).toBe(250);
      expect(snapshot.telemetry?.cumulative).toEqual({
        uncachedInput: 1000,
        cacheRead: 3000,
        output: 650,
        total: 4650,
      });
    } finally {
      await close();
    }
  });

  it('fails open on malformed hook payloads or unwritable PLUGIN_DATA paths', async () => {
    const badJson = await runHookIndexer('{not-valid-json', pluginDataDir);
    expect(badJson.exitCode).toBe(0);
    expect(badJson.stdout).toBe('{}');

    const missingFields = await runHookIndexer(JSON.stringify({ hookEventName: 'Stop' }), pluginDataDir);
    expect(missingFields.exitCode).toBe(0);
    expect(missingFields.stdout).toBe('{}');

    // Point dataDir to a regular file so mkdir/write fails
    const blockingFile = path.join(tmpDir, 'not-a-dir');
    await fs.writeFile(blockingFile, 'occupied', 'utf8');
    const unwritable = await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-1',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: path.join(tmpDir, 't.jsonl'),
      }),
      blockingFile,
    );
    expect(unwritable.exitCode).toBe(0);
    expect(unwritable.stdout).toBe('{}');
  });

  it('skips corrupt JSON lines and degrades safely when transcript.jsonl is missing or empty', async () => {
    const corruptTranscript = path.join(tmpDir, 'corrupt.jsonl');
    await fs.writeFile(
      corruptTranscript,
      [
        '{broken json line',
        JSON.stringify({
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          model: 'gemini-4-neon-medium',
          input_tokens: 1000,
          cache_read_tokens: 2000,
          output_tokens: 300,
        }),
        '{"truncated": true',
      ].join('\n'),
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-corrupt',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: corruptTranscript,
      }),
      pluginDataDir,
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      let res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      let snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.contextUsage).toBe(3300);
      expect(snapshot.statusLevel).toBe('normal');

      // Empty (0-byte) transcript file
      const emptyTranscript = path.join(tmpDir, 'empty.jsonl');
      await fs.writeFile(emptyTranscript, '', 'utf8');
      await runHookIndexer(
        JSON.stringify({
          conversationId: 'conv-empty',
          modelName: 'gemini-4-neon-medium',
          transcriptPath: emptyTranscript,
        }),
        pluginDataDir,
      );
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry).toBeNull();
      expect(snapshot.statusLevel).toBe('empty');

      // Missing transcript file
      await runHookIndexer(
        JSON.stringify({
          conversationId: 'conv-missing',
          modelName: 'gemini-4-neon-medium',
          transcriptPath: path.join(tmpDir, 'does-not-exist.jsonl'),
        }),
        pluginDataDir,
      );
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry).toBeNull();
      expect(snapshot.statusLevel).toBe('empty');
    } finally {
      await close();
    }
  });

  it('executes bundled dist/hook.mjs via stdin and PLUGIN_DATA env var', async () => {
    const hookScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/hook.mjs');
    const transcriptPath = path.join(tmpDir, 'cli-transcript.jsonl');
    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        model: 'claude-sonnet-4-20250514',
        input_tokens: 5000,
        cache_read_tokens: 15000,
        output_tokens: 1000,
      }) + '\n',
      'utf8',
    );

    const stdout = execFileSync(process.execPath, [hookScript], {
      input: JSON.stringify({
        conversationId: 'conv-cli-1',
        modelName: 'claude-sonnet-4-20250514',
        transcriptPath,
        hookEventName: 'Stop',
      }),
      env: { ...process.env, PLUGIN_DATA: pluginDataDir },
      encoding: 'utf8',
    });

    expect(stdout).toBe('{}');

    const { client, close } = await connectClient(pluginDataDir);
    try {
      const res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.activeConversationId).toBe('conv-cli-1');
      expect(snapshot.telemetry?.contextUsage).toBe(21000);
      expect(snapshot.telemetry?.limit).toBe(200000);
      expect(snapshot.statusLevel).toBe('normal');
    } finally {
      await close();
    }
  });

  it('returns limit: null and statusLevel: unknown for unrecognized models without config.json', async () => {
    const unknownTranscript = path.join(tmpDir, 'unknown-model.jsonl');
    await fs.writeFile(
      unknownTranscript,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        model: 'gemini-next-exp-05',
        input_tokens: 14200,
        cache_read_tokens: 48600,
        output_tokens: 1120,
      }) + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-unknown-1',
        modelName: 'gemini-next-exp-05',
        transcriptPath: unknownTranscript,
      }),
      pluginDataDir,
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      const res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const snapshot = res.structuredContent as unknown as TelemetrySnapshot;

      expect(snapshot.statusLevel).toBe('unknown');
      expect(snapshot.telemetry?.model).toBe('gemini-next-exp-05');
      expect(snapshot.telemetry?.limit).toBeNull();
      expect(snapshot.telemetry?.utilizationPct).toBeNull();
      expect(snapshot.telemetry?.remainingTokens).toBeNull();
      expect(snapshot.telemetry?.contextUsage).toBe(63920);
      expect(snapshot.telemetry?.cacheHitRate).toBeCloseTo(77.3885, 3);
      expect(snapshot.telemetry?.cumulative.total).toBe(63920);
    } finally {
      await close();
    }
  });

  it('resolves Context Window Limit from PLUGIN_DATA/config.json with exact and normalized prefix precedence over built-in limits', async () => {
    await fs.mkdir(pluginDataDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDataDir, 'config.json'),
      JSON.stringify({
        contextWindowLimits: {
          'gemini-4-neon': 300000,
          'GEMINI-4-NEON-MEDIUM': 500000,
          'custom-llm': 64000,
          'custom-llm-pro': 128000,
        },
      }),
      'utf8',
    );

    // 1. Exact override beats both shorter custom prefix and built-in table (200,000 -> 500,000)
    const exactOverrideTranscript = path.join(tmpDir, 'exact-override.jsonl');
    await fs.writeFile(
      exactOverrideTranscript,
      JSON.stringify({
        step_index: 1,
        model: 'gemini-4-neon-medium',
        input_tokens: 50000,
        cache_read_tokens: 50000,
        output_tokens: 0,
      }) + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-exact-override',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: exactOverrideTranscript,
      }),
      pluginDataDir,
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      let res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      let snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(500000);
      expect(snapshot.telemetry?.utilizationPct).toBeCloseTo(20.0, 4);
      expect(snapshot.telemetry?.remainingTokens).toBe(400000);
      expect(snapshot.statusLevel).toBe('normal');

      // 2. Normalized prefix match (longest prefix wins: custom-llm-pro beats custom-llm)
      const prefixTranscript = path.join(tmpDir, 'prefix-override.jsonl');
      await fs.writeFile(
        prefixTranscript,
        JSON.stringify({
          step_index: 1,
          model: 'Custom-LLM-Pro-2026',
          input_tokens: 96000,
          cache_read_tokens: 0,
          output_tokens: 0,
        }) + '\n',
        'utf8',
      );
      await runHookIndexer(
        JSON.stringify({
          conversationId: 'conv-prefix-override',
          modelName: 'Custom-LLM-Pro-2026',
          transcriptPath: prefixTranscript,
        }),
        pluginDataDir,
      );

      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(128000);
      expect(snapshot.telemetry?.utilizationPct).toBeCloseTo(75.0, 4);
      expect(snapshot.telemetry?.remainingTokens).toBe(32000);
      expect(snapshot.statusLevel).toBe('warning');
    } finally {
      await close();
    }
  });

  it('safely falls back to built-in limits when config.json is empty, malformed, or has invalid field values', async () => {
    const transcript = path.join(tmpDir, 'fallback.jsonl');
    await fs.writeFile(
      transcript,
      JSON.stringify({
        step_index: 1,
        model: 'gemini-4-neon-medium',
        input_tokens: 20000,
        cache_read_tokens: 0,
        output_tokens: 0,
      }) + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-fallback',
        modelName: 'gemini-4-neon-medium',
        transcriptPath: transcript,
      }),
      pluginDataDir,
    );

    const configPath = path.join(pluginDataDir, 'config.json');
    const { client, close } = await connectClient(pluginDataDir);
    try {
      // 1. Corrupt JSON syntax
      await fs.writeFile(configPath, '{invalid-json', 'utf8');
      let res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      let snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(200000);
      expect(snapshot.statusLevel).toBe('normal');

      // 2. Empty file
      await fs.writeFile(configPath, '', 'utf8');
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(200000);

      // 3. Invalid per-model values (negative, zero, float, string) ignored while valid siblings still work
      await fs.writeFile(
        configPath,
        JSON.stringify({
          contextWindowLimits: {
            'gemini-4-neon-medium': -100,
            'gemini-4-neon': 0,
            'float-model': 12345.67,
            'string-model': '200000',
            'valid-custom': 80000,
          },
        }),
        'utf8',
      );
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(200000);

      // Verify float/string entries are rejected (degrade to unknown) while valid-custom works
      const floatTranscript = path.join(tmpDir, 'float-model.jsonl');
      await fs.writeFile(
        floatTranscript,
        JSON.stringify({ step_index: 1, model: 'float-model', input_tokens: 1000, cache_read_tokens: 0, output_tokens: 0 }) + '\n',
        'utf8',
      );
      await runHookIndexer(
        JSON.stringify({ conversationId: 'conv-float', modelName: 'float-model', transcriptPath: floatTranscript }),
        pluginDataDir,
      );
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBeNull();
      expect(snapshot.statusLevel).toBe('unknown');

      const validTranscript = path.join(tmpDir, 'valid-custom.jsonl');
      await fs.writeFile(
        validTranscript,
        JSON.stringify({ step_index: 1, model: 'valid-custom', input_tokens: 40000, cache_read_tokens: 0, output_tokens: 0 }) + '\n',
        'utf8',
      );
      await runHookIndexer(
        JSON.stringify({ conversationId: 'conv-valid', modelName: 'valid-custom', transcriptPath: validTranscript }),
        pluginDataDir,
      );
      res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.telemetry?.limit).toBe(80000);
      expect(snapshot.telemetry?.utilizationPct).toBeCloseTo(50.0, 4);
      expect(snapshot.statusLevel).toBe('normal');
    } finally {
      await close();
    }
  });

  it('exposes app-only query tool (visibility: ["app"]) supporting descending lastActiveAt sorting and conversationId lookup', async () => {
    const tOld = path.join(tmpDir, 'conv-old.jsonl');
    const tMid = path.join(tmpDir, 'conv-mid.jsonl');
    const tNew = path.join(tmpDir, 'conv-new.jsonl');

    await fs.writeFile(
      tOld,
      JSON.stringify({
        step_index: 1,
        model: 'gemini-4-neon-medium',
        input_tokens: 10000,
        cache_read_tokens: 5000,
        output_tokens: 500,
      }) + '\n',
      'utf8',
    );
    await fs.writeFile(
      tMid,
      JSON.stringify({
        step_index: 1,
        model: 'claude-sonnet-4-20250514',
        input_tokens: 40000,
        cache_read_tokens: 110000,
        output_tokens: 6000,
      }) + '\n',
      'utf8',
    );
    await fs.writeFile(
      tNew,
      JSON.stringify({
        step_index: 1,
        model: 'gemini-4-neon-medium',
        input_tokens: 20000,
        cache_read_tokens: 165000,
        output_tokens: 1000,
      }) + '\n',
      'utf8',
    );

    // Write index with intentionally unsorted lastActiveAt timestamps to verify descending sort
    await fs.mkdir(pluginDataDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDataDir, 'index.json'),
      JSON.stringify({
        version: 1,
        conversations: [
          {
            conversationId: 'conv-old',
            modelName: 'gemini-4-neon-medium',
            transcriptPath: tOld,
            title: 'Oldest Session',
            lastActiveAt: '2026-11-26T01:00:00.000Z',
          },
          {
            conversationId: 'conv-new',
            modelName: 'gemini-4-neon-medium',
            transcriptPath: tNew,
            title: 'Newest Session',
            lastActiveAt: '2026-11-26T03:00:00.000Z',
          },
          {
            conversationId: 'conv-mid',
            modelName: 'claude-sonnet-4-20250514',
            transcriptPath: tMid,
            title: 'Middle Session',
            lastActiveAt: '2026-11-26T02:00:00.000Z',
          },
        ],
      }),
      'utf8',
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      // 1. Tool metadata declares visibility: ["app"] (hidden from model)
      const { tools } = await client.listTools();
      const queryTool = tools.find((t) => t.name === APP_QUERY_TOOL_NAME);
      expect(queryTool).toBeDefined();
      const meta = queryTool?._meta as Record<string, unknown> | undefined;
      const uiMeta = meta?.ui as { visibility?: string[] } | undefined;
      expect(uiMeta?.visibility).toEqual(['app']);

      // 2. Default call ({}) returns conversations sorted descending by lastActiveAt and newest telemetry
      const defaultRes = await client.callTool({ name: APP_QUERY_TOOL_NAME, arguments: {} });
      expect(defaultRes.isError).toBeFalsy();
      const defaultSnapshot = defaultRes.structuredContent as unknown as TelemetrySnapshot;
      expect(defaultSnapshot.conversations.map((c) => c.conversationId)).toEqual([
        'conv-new',
        'conv-mid',
        'conv-old',
      ]);
      expect(defaultSnapshot.activeConversationId).toBe('conv-new');
      expect(defaultSnapshot.telemetry?.contextUsage).toBe(186000);
      expect(defaultSnapshot.statusLevel).toBe('critical');

      // 3. Query by specific conversationId returns that conversation's telemetry while keeping full sorted list
      const midRes = await client.callTool({
        name: APP_QUERY_TOOL_NAME,
        arguments: { conversationId: 'conv-mid' },
      });
      const midSnapshot = midRes.structuredContent as unknown as TelemetrySnapshot;
      expect(midSnapshot.activeConversationId).toBe('conv-mid');
      expect(midSnapshot.conversations.map((c) => c.conversationId)).toEqual([
        'conv-new',
        'conv-mid',
        'conv-old',
      ]);
      expect(midSnapshot.telemetry?.model).toBe('claude-sonnet-4-20250514');
      expect(midSnapshot.telemetry?.contextUsage).toBe(156000);
      expect(midSnapshot.statusLevel).toBe('warning');

      // 4. Query with unknown conversationId falls back safely to the most recently active conversation
      const fallbackRes = await client.callTool({
        name: APP_QUERY_TOOL_NAME,
        arguments: { conversationId: 'conv-does-not-exist' },
      });
      const fallbackSnapshot = fallbackRes.structuredContent as unknown as TelemetrySnapshot;
      expect(fallbackSnapshot.activeConversationId).toBe('conv-new');
      expect(fallbackSnapshot.telemetry?.contextUsage).toBe(186000);
    } finally {
      await close();
    }
  });

  it('persists, hydrates, and resets 6-color custom palette via app-only tool while preserving config.json Context Window Limits', async () => {
    const transcriptPath = path.join(tmpDir, 'palette-session.jsonl');
    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        step_index: 1,
        model: 'custom-palette-model',
        input_tokens: 20000,
        cache_read_tokens: 30000,
        output_tokens: 1000,
      }) + '\n',
      'utf8',
    );
    await runHookIndexer(
      JSON.stringify({
        conversationId: 'conv-palette',
        modelName: 'custom-palette-model',
        transcriptPath,
      }),
      pluginDataDir,
    );

    // Pre-existing Context Window Limit override in config.json must not be clobbered
    const configPath = path.join(pluginDataDir, 'config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        contextWindowLimits: {
          'custom-palette-model': 100000,
        },
      }),
      'utf8',
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      // 1. Tool metadata declares visibility: ["app"]
      const { tools } = await client.listTools();
      const saveTool = tools.find((t) => t.name === APP_SAVE_COLORS_TOOL_NAME);
      expect(saveTool).toBeDefined();
      const meta = saveTool?._meta as Record<string, unknown> | undefined;
      const uiMeta = meta?.ui as { visibility?: string[] } | undefined;
      expect(uiMeta?.visibility).toEqual(['app']);

      // 2. Save all 6 custom colors (mixed case normalized to lowercase)
      const palette: CustomColorPalette = {
        success: '#16A34A',
        warning: '#D97706',
        error: '#DC2626',
        cacheRead: '#2563EB',
        uncachedInput: '#059669',
        output: '#EA580C',
      };
      const saveRes = await client.callTool({
        name: APP_SAVE_COLORS_TOOL_NAME,
        arguments: { colors: palette },
      });
      expect(saveRes.isError).toBeFalsy();
      const savedStructured = saveRes.structuredContent as { customColors?: CustomColorPalette };
      expect(savedStructured.customColors).toEqual({
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626',
        cacheRead: '#2563eb',
        uncachedInput: '#059669',
        output: '#ea580c',
      });

      // 3. Both entrypoint tool and app query tool return saved palette AND preserve Context Window Limit
      const entryRes = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const entrySnapshot = entryRes.structuredContent as unknown as TelemetrySnapshot;
      expect(entrySnapshot.telemetry?.limit).toBe(100000);
      expect(entrySnapshot.customColors).toEqual({
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626',
        cacheRead: '#2563eb',
        uncachedInput: '#059669',
        output: '#ea580c',
      });

      const queryRes = await client.callTool({ name: APP_QUERY_TOOL_NAME, arguments: {} });
      const querySnapshot = queryRes.structuredContent as unknown as TelemetrySnapshot;
      expect(querySnapshot.customColors).toEqual(entrySnapshot.customColors);

      // 4. Reset clears customColors while keeping contextWindowLimits intact
      const resetRes = await client.callTool({
        name: APP_SAVE_COLORS_TOOL_NAME,
        arguments: { reset: true },
      });
      expect(resetRes.isError).toBeFalsy();
      expect((resetRes.structuredContent as { customColors?: CustomColorPalette }).customColors).toEqual({});

      const afterResetRes = await client.callTool({ name: APP_QUERY_TOOL_NAME, arguments: {} });
      const afterResetSnapshot = afterResetRes.structuredContent as unknown as TelemetrySnapshot;
      expect(afterResetSnapshot.customColors).toEqual({});
      expect(afterResetSnapshot.telemetry?.limit).toBe(100000);

      // 5. Partial invalid colors in config.json are ignored while valid siblings survive
      await fs.writeFile(
        configPath,
        JSON.stringify({
          contextWindowLimits: { 'custom-palette-model': 100000 },
          customColors: {
            success: '#123456',
            warning: 'not-a-hex',
            error: '#fff',
            cacheRead: 42,
            unknownKey: '#abcdef',
          },
        }),
        'utf8',
      );
      const sanitizedRes = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const sanitizedSnapshot = sanitizedRes.structuredContent as unknown as TelemetrySnapshot;
      expect(sanitizedSnapshot.customColors).toEqual({ success: '#123456' });
      expect(sanitizedSnapshot.telemetry?.limit).toBe(100000);
    } finally {
      await close();
    }
  });

  it('returns saved customColors even when no conversations are indexed (empty state)', async () => {
    await fs.mkdir(pluginDataDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDataDir, 'config.json'),
      JSON.stringify({ customColors: { success: '#10b981' } }),
      'utf8',
    );

    const { client, close } = await connectClient(pluginDataDir);
    try {
      const res = await client.callTool({ name: ENTRYPOINT_TOOL_NAME, arguments: {} });
      const snapshot = res.structuredContent as unknown as TelemetrySnapshot;
      expect(snapshot.statusLevel).toBe('empty');
      expect(snapshot.customColors).toEqual({ success: '#10b981' });
    } finally {
      await close();
    }
  });
});
