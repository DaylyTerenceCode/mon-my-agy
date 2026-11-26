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
import { createMcpServer, APP_RESOURCE_URI, ENTRYPOINT_TOOL_NAME } from '../src/server/mcp-server.js';
import type { TelemetrySnapshot } from '../src/shared/types.js';

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
        cumulative: {
          uncachedInput: 25649,
          cacheRead: 31339,
          output: 1127,
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
});
