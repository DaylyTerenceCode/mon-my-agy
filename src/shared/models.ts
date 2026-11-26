/**
 * Built-in Context Window Limit lookup table (in tokens).
 * Ordered from most specific prefixes to general prefixes.
 */
const BUILTIN_CONTEXT_WINDOW_LIMITS: ReadonlyArray<readonly [string, number]> = [
  // Gemini 4 series
  ['gemini-4-neon', 524_288],
  ['gemini-4-carbon', 524_288],
  ['gemini-4-hydrogen', 524_288],
  // Gemini 2.5 / 2.0 / 1.5 series
  ['gemini-2.5-pro', 1_000_000],
  ['gemini-2.5-flash', 1_000_000],
  ['gemini-2.0-flash', 1_000_000],
  ['gemini-1.5-pro', 2_000_000],
  ['gemini-1.5-flash', 1_000_000],
  // Claude 4 / 3.7 / 3.5 series
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-3-7-sonnet', 200_000],
  ['claude-3.7-sonnet', 200_000],
  ['claude-3-5-sonnet', 200_000],
  ['claude-3.5-sonnet', 200_000],
  ['claude-3-5-haiku', 200_000],
  ['claude-3.5-haiku', 200_000],
  // OpenAI GPT / o-series
  ['gpt-4.1', 1_047_576],
  ['gpt-4o', 128_000],
  ['o4-mini', 200_000],
  ['o3', 200_000],
];

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function matchesNormalizedPrefix(normalizedModel: string, normalizedPrefix: string): boolean {
  return (
    normalizedModel === normalizedPrefix ||
    normalizedModel.startsWith(`${normalizedPrefix}-`) ||
    normalizedModel.startsWith(`${normalizedPrefix}:`) ||
    normalizedModel.startsWith(`${normalizedPrefix}@`) ||
    normalizedModel.startsWith(`${normalizedPrefix}/`)
  );
}

function normalizeModelName(modelName: string): string | null {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return null;
  }
  return normalized;
}

function matchBuiltinLimit(normalizedModel: string): number | null {
  for (const [prefix, limit] of BUILTIN_CONTEXT_WINDOW_LIMITS) {
    if (matchesNormalizedPrefix(normalizedModel, prefix)) {
      return limit;
    }
  }
  return null;
}

/**
 * Resolves the built-in Context Window Limit for a model name.
 * Returns null if the model is not recognized (triggering unknown-model degradation).
 */
export function resolveBuiltinContextWindowLimit(modelName: string): number | null {
  const normalized = normalizeModelName(modelName);
  return normalized ? matchBuiltinLimit(normalized) : null;
}

/**
 * Resolves the Context Window Limit with priority:
 * 1. User overrides from PLUGIN_DATA/config.json (exact match, then longest normalized prefix match; positive integers only)
 * 2. Built-in lookup table
 * 3. null (triggers unknown-model degradation)
 */
export function resolveContextWindowLimit(
  modelName: string,
  customLimits?: Record<string, number>,
): number | null {
  const normalized = normalizeModelName(modelName);
  if (!normalized) {
    return null;
  }

  if (customLimits) {
    const validEntries: Array<[string, number]> = [];
    for (const [rawKey, rawValue] of Object.entries(customLimits)) {
      const normalizedKey = rawKey.trim().toLowerCase();
      if (!normalizedKey || !isPositiveInteger(rawValue)) continue;
      if (normalizedKey === normalized) {
        return rawValue;
      }
      validEntries.push([normalizedKey, rawValue]);
    }

    validEntries.sort((a, b) => b[0].length - a[0].length);
    for (const [prefix, limit] of validEntries) {
      if (matchesNormalizedPrefix(normalized, prefix)) {
        return limit;
      }
    }
  }

  return matchBuiltinLimit(normalized);
}
