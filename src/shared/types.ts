export const INDEX_FILENAME = 'index.json';

export type StatusLevel = 'empty' | 'unknown' | 'normal' | 'warning' | 'critical';

export interface CumulativeUsage {
  uncachedInput: number;
  cacheRead: number;
  output: number;
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
