import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isPositiveInteger, resolveContextWindowLimit } from '../shared/models.js';
import {
  CONFIG_FILENAME,
  getStatusLevel,
  INDEX_FILENAME,
  isConversationIndexEntry,
  sanitizeCustomColorPalette,
  type ConversationIndexEntry,
  type ConversationIndexFile,
  type ConversationSummary,
  type ConversationTelemetry,
  type CustomColorPalette,
  type PluginConfig,
  type SaveColorPaletteInput,
  type TelemetrySnapshot,
} from '../shared/types.js';

interface ParsedInvocation {
  model?: string;
  uncachedInput: number;
  cacheRead: number;
  output: number;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return null;
}

function parseTranscriptLine(line: string): ParsedInvocation | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const uncachedInput =
    toNonNegativeInt(obj.input_tokens) ??
    toNonNegativeInt(obj.inputTokens) ??
    toNonNegativeInt(obj.uncachedInput);
  const cacheRead =
    toNonNegativeInt(obj.cache_read_tokens) ??
    toNonNegativeInt(obj.cacheReadTokens) ??
    toNonNegativeInt(obj.cacheRead);
  const output =
    toNonNegativeInt(obj.output_tokens) ??
    toNonNegativeInt(obj.outputTokens) ??
    toNonNegativeInt(obj.output);

  if (uncachedInput === null && cacheRead === null && output === null) {
    return null;
  }

  const model =
    typeof obj.model === 'string' && obj.model.trim()
      ? obj.model.trim()
      : typeof obj.modelName === 'string' && obj.modelName.trim()
        ? obj.modelName.trim()
        : undefined;

  return {
    model,
    uncachedInput: uncachedInput ?? 0,
    cacheRead: cacheRead ?? 0,
    output: output ?? 0,
  };
}

async function readConversationIndex(dataDir: string): Promise<ConversationIndexEntry[]> {
  try {
    const raw = await fs.readFile(path.join(dataDir, INDEX_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ConversationIndexFile>;
    if (!Array.isArray(parsed.conversations)) return [];
    return parsed.conversations
      .filter(isConversationIndexEntry)
      .sort((a, b) => {
        const tb = Date.parse(b.lastActiveAt);
        const ta = Date.parse(a.lastActiveAt);
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });
  } catch {
    return [];
  }
}

async function readRawConfigObject(dataDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path.join(dataDir, CONFIG_FILENAME), 'utf8');
    if (!raw.trim()) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readPluginConfig(dataDir: string): Promise<PluginConfig> {
  const obj = await readRawConfigObject(dataDir);
  const config: PluginConfig = {};

  const rawLimits = obj.contextWindowLimits;
  if (rawLimits && typeof rawLimits === 'object' && !Array.isArray(rawLimits)) {
    const contextWindowLimits: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawLimits as Record<string, unknown>)) {
      const trimmedKey = key.trim();
      if (trimmedKey && isPositiveInteger(value)) {
        contextWindowLimits[trimmedKey] = value;
      }
    }
    config.contextWindowLimits = contextWindowLimits;
  }

  config.customColors = sanitizeCustomColorPalette(obj.customColors);
  return config;
}

export async function saveCustomColorPalette(
  dataDir: string,
  options: SaveColorPaletteInput,
): Promise<CustomColorPalette> {
  const rawObj = await readRawConfigObject(dataDir);
  const nextPalette: CustomColorPalette = options.reset
    ? {}
    : sanitizeCustomColorPalette(options.colors);

  if (Object.keys(nextPalette).length === 0) {
    delete rawObj.customColors;
  } else {
    rawObj.customColors = nextPalette;
  }

  await fs.mkdir(dataDir, { recursive: true });
  const targetPath = path.join(dataDir, CONFIG_FILENAME);
  const tmpPath = path.join(
    dataDir,
    `${CONFIG_FILENAME}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`,
  );
  await fs.writeFile(tmpPath, JSON.stringify(rawObj, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, targetPath);

  return nextPalette;
}

async function parseTranscriptTelemetry(
  entry: ConversationIndexEntry,
  customLimits?: Record<string, number>,
): Promise<ConversationTelemetry | null> {
  let raw: string;
  try {
    raw = await fs.readFile(entry.transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  let latest: ParsedInvocation | null = null;
  let cumulativeUncached = 0;
  let cumulativeCacheRead = 0;
  let cumulativeOutput = 0;

  for (const line of lines) {
    const inv = parseTranscriptLine(line);
    if (!inv) continue;
    latest = inv;
    cumulativeUncached += inv.uncachedInput;
    cumulativeCacheRead += inv.cacheRead;
    cumulativeOutput += inv.output;
  }

  if (!latest) {
    return null;
  }

  const model = latest.model ?? entry.modelName;
  const limit = resolveContextWindowLimit(model, customLimits);
  const contextUsage = latest.uncachedInput + latest.cacheRead + latest.output;
  const utilizationPct = limit !== null && limit > 0 ? (contextUsage / limit) * 100 : null;
  const remainingTokens = limit !== null ? Math.max(0, limit - contextUsage) : null;
  const totalInput = latest.uncachedInput + latest.cacheRead;
  const cacheHitRate = totalInput > 0 ? (latest.cacheRead / totalInput) * 100 : 0;

  return {
    model,
    limit,
    uncachedInput: latest.uncachedInput,
    cacheRead: latest.cacheRead,
    output: latest.output,
    contextUsage,
    utilizationPct,
    remainingTokens,
    cacheHitRate,
    cumulative: {
      uncachedInput: cumulativeUncached,
      cacheRead: cumulativeCacheRead,
      output: cumulativeOutput,
      total: cumulativeUncached + cumulativeCacheRead + cumulativeOutput,
    },
  };
}

export async function readTelemetrySnapshot(
  dataDir: string,
  requestedConversationId?: string,
): Promise<TelemetrySnapshot> {
  const [entries, config] = await Promise.all([
    readConversationIndex(dataDir),
    readPluginConfig(dataDir),
  ]);
  const customColors = config.customColors ?? {};
  const conversations: ConversationSummary[] = entries.map((e) => ({
    conversationId: e.conversationId,
    modelName: e.modelName,
    title: e.title ?? e.conversationId,
    lastActiveAt: e.lastActiveAt,
  }));

  if (entries.length === 0) {
    return {
      activeConversationId: null,
      conversations: [],
      telemetry: null,
      statusLevel: 'empty',
      customColors,
    };
  }

  const target =
    (requestedConversationId
      ? entries.find((e) => e.conversationId === requestedConversationId)
      : undefined) ?? entries[0]!;

  const telemetry = await parseTranscriptTelemetry(target, config.contextWindowLimits);
  if (!telemetry) {
    return {
      activeConversationId: target.conversationId,
      conversations,
      telemetry: null,
      statusLevel: 'empty',
      customColors,
    };
  }

  return {
    activeConversationId: target.conversationId,
    conversations,
    telemetry,
    statusLevel: getStatusLevel(telemetry.utilizationPct),
    customColors,
  };
}
