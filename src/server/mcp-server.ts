import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { readTelemetrySnapshot } from './store.js';
import type { TelemetrySnapshot } from '../shared/types.js';

export const APP_RESOURCE_URI = 'ui://mon-my-agy/context-usage.html';
export const ENTRYPOINT_TOOL_NAME = 'open_context_usage';

export interface CreateMcpServerOptions {
  dataDir: string;
  loadUiHtml: () => Promise<string>;
}

function formatSummaryText(snapshot: TelemetrySnapshot): string {
  if (!snapshot.telemetry) {
    return 'Mon-My-Agy: No indexed conversation telemetry available yet.';
  }
  const { model, contextUsage, limit, utilizationPct, remainingTokens } = snapshot.telemetry;
  if (limit !== null && utilizationPct !== null && remainingTokens !== null) {
    return `Mon-My-Agy (${model}): Context Usage ${contextUsage.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} (${utilizationPct.toFixed(1)}%), remaining ${remainingTokens.toLocaleString('en-US')} tokens [${snapshot.statusLevel}].`;
  }
  return `Mon-My-Agy (${model}): Context Usage ${contextUsage.toLocaleString('en-US')} tokens (Context Window Limit unknown).`;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'mon-my-agy',
    version: '0.1.0',
  });

  registerAppResource(
    server,
    'Mon-My-Agy Context Usage Panel',
    APP_RESOURCE_URI,
    {
      description: 'Self-contained MCP App UI for Context Usage monitoring',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async () => {
      const html = await options.loadUiHtml();
      return {
        contents: [
          {
            uri: APP_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    ENTRYPOINT_TOOL_NAME,
    {
      title: 'Mon-My-Agy',
      description: 'Open the Mon-My-Agy Context Usage monitoring panel for the active conversation.',
      inputSchema: {
        conversationId: z.string().optional().describe('Optional conversation ID to inspect'),
      },
      _meta: {
        ui: {
          resourceUri: APP_RESOURCE_URI,
        },
        'com.google.antigravity/ui': {
          entrypoints: [
            {
              type: 'aux_pane',
              title: 'Mon-My-Agy',
            },
          ],
        },
      },
    },
    async (args) => {
      const snapshot = await readTelemetrySnapshot(options.dataDir, args.conversationId);
      return {
        content: [
          {
            type: 'text' as const,
            text: formatSummaryText(snapshot),
          },
        ],
        structuredContent: snapshot as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}
