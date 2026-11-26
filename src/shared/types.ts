export const INDEX_FILENAME = 'index.json';
export const CONFIG_FILENAME = 'config.json';
export const APP_QUERY_TOOL_NAME = 'get_context_usage';
export const APP_SAVE_COLORS_TOOL_NAME = 'save_color_palette';

export type CustomColorKey =
  | 'success'
  | 'warning'
  | 'error'
  | 'cacheRead'
  | 'uncachedInput'
  | 'output';

export const CUSTOM_COLOR_KEYS: readonly CustomColorKey[] = [
  'success',
  'warning',
  'error',
  'cacheRead',
  'uncachedInput',
  'output',
] as const;

export type CustomColorPalette = Partial<Record<CustomColorKey, string>>;

export interface SaveColorPaletteInput {
  colors?: CustomColorPalette;
  reset?: boolean;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function sanitizeCustomColorPalette(input: unknown): CustomColorPalette {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const obj = input as Record<string, unknown>;
  const result: CustomColorPalette = {};
  for (const key of CUSTOM_COLOR_KEYS) {
    const normalized = normalizeHexColor(obj[key]);
    if (normalized) {
      result[key] = normalized;
    }
  }
  return result;
}

export interface PluginConfig {
  contextWindowLimits?: Record<string, number>;
  customColors?: CustomColorPalette;
}

export type StatusLevel = 'empty' | 'unknown' | 'normal' | 'warning' | 'critical';

export interface CumulativeUsage {
  uncachedInput: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface ConversationTelemetry {
  model: string;
  /** Context Window Limit; null triggers unknown-model degradation. */
  limit: number | null;
  uncachedInput: number;
  cacheRead: number;
  output: number;
  /** Context Usage = uncachedInput + cacheRead + output */
  contextUsage: number;
  /** Percentage of Context Window Limit occupied, or null when limit is unknown. */
  utilizationPct: number | null;
  /** Remaining Context Window capacity in tokens, or null when limit is unknown. */
  remainingTokens: number | null;
  /** Cache Hit Rate = (uncachedInput + cacheRead) > 0 ? (cacheRead / (uncachedInput + cacheRead)) * 100 : 0 */
  cacheHitRate: number;
  cumulative: CumulativeUsage;
}

export interface ConversationIndexEntry {
  conversationId: string;
  modelName: string;
  transcriptPath: string;
  title?: string;
  lastActiveAt: string;
}

export interface ConversationIndexFile {
  version: 1;
  conversations: ConversationIndexEntry[];
}

export interface ConversationSummary {
  conversationId: string;
  modelName: string;
  title: string;
  lastActiveAt: string;
}

export interface TelemetrySnapshot {
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  telemetry: ConversationTelemetry | null;
  statusLevel: StatusLevel;
  customColors?: CustomColorPalette;
}

export function isConversationIndexEntry(entry: unknown): entry is ConversationIndexEntry {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<ConversationIndexEntry>;
  return (
    typeof candidate.conversationId === 'string' &&
    typeof candidate.transcriptPath === 'string' &&
    typeof candidate.lastActiveAt === 'string'
  );
}

export function getStatusLevel(pct: number | null): Exclude<StatusLevel, 'empty'> {
  if (pct === null) return 'unknown';
  if (pct >= 85) return 'critical';
  if (pct >= 70) return 'warning';
  return 'normal';
}
