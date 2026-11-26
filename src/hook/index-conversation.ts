import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  INDEX_FILENAME,
  isConversationIndexEntry,
  type ConversationIndexEntry,
  type ConversationIndexFile,
} from '../shared/types.js';

const MAX_INDEXED_CONVERSATIONS = 50;

export interface HookRunResult {
  exitCode: 0;
  stdout: string;
}

interface RawHookPayload {
  conversationId?: unknown;
  modelName?: unknown;
  transcriptPath?: unknown;
  lastUserInput?: unknown;
}

function deriveTitle(lastUserInput: unknown, conversationId: string): string {
  if (typeof lastUserInput === 'string') {
    const cleaned = lastUserInput.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) {
      return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
    }
  }
  return conversationId;
}

function readExistingIndex(indexPath: string): ConversationIndexEntry[] {
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ConversationIndexFile>;
    if (Array.isArray(parsed.conversations)) {
      return parsed.conversations.filter(isConversationIndexEntry);
    }
  } catch {
    // Missing or corrupt index file: start fresh
  }
  return [];
}

function writeAtomicJson(targetPath: string, data: ConversationIndexFile): void {
  const dir = path.dirname(targetPath);
  const tmpName = `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  const serialized = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpPath, serialized, 'utf8');
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch {
    // Fallback on Windows when concurrent readers momentarily lock targetPath
    try {
      fs.copyFileSync(tmpPath, targetPath);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

/**
 * Indexes an Antigravity lifecycle hook payload into `${PLUGIN_DATA}/index.json`.
 * Always fail-open: returns exitCode 0 and "{}" stdout on any malformed input or I/O failure.
 */
export async function runHookIndexer(rawStdin: string, dataDir?: string): Promise<HookRunResult> {
  const ok: HookRunResult = { exitCode: 0, stdout: '{}' };
  try {
    if (!dataDir || !rawStdin.trim()) {
      return ok;
    }

    const payload = JSON.parse(rawStdin) as RawHookPayload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.conversationId !== 'string' ||
      !payload.conversationId.trim() ||
      typeof payload.transcriptPath !== 'string' ||
      !payload.transcriptPath.trim()
    ) {
      return ok;
    }

    fs.mkdirSync(dataDir, { recursive: true });
    const indexPath = path.join(dataDir, INDEX_FILENAME);
    const existing = readExistingIndex(indexPath);

    const prev = existing.find((c) => c.conversationId === payload.conversationId);
    const hasUserInput =
      typeof payload.lastUserInput === 'string' && payload.lastUserInput.trim().length > 0;

    // Ignore background subagent / non-interactive sessions that carry no user input
    if (!hasUserInput && !prev) {
      return ok;
    }

    const modelName =
      typeof payload.modelName === 'string' && payload.modelName.trim()
        ? payload.modelName.trim()
        : prev?.modelName ?? 'unknown';

    const title = hasUserInput
      ? deriveTitle(payload.lastUserInput, payload.conversationId)
      : prev?.title ?? payload.conversationId;

    const updatedEntry: ConversationIndexEntry = {
      conversationId: payload.conversationId,
      modelName,
      transcriptPath: payload.transcriptPath,
      title,
      lastActiveAt: new Date().toISOString(),
    };

    const nextConversations = [
      updatedEntry,
      ...existing.filter((c) => c.conversationId !== payload.conversationId),
    ].slice(0, MAX_INDEXED_CONVERSATIONS);

    writeAtomicJson(indexPath, {
      version: 1,
      conversations: nextConversations,
    });

    return ok;
  } catch {
    // Strictly fail-open: never block or crash the host agent loop
    return ok;
  }
}

function parseDataDirArg(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith('--data_dir=')) {
      return arg.slice('--data_dir='.length);
    }
  }
  return process.env.PLUGIN_DATA;
}

function readStdinSync(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const dataDir = parseDataDirArg(process.argv.slice(2));
  const rawStdin = readStdinSync();
  runHookIndexer(rawStdin, dataDir).then((res) => {
    process.stdout.write(res.stdout);
    process.exit(res.exitCode);
  });
}
