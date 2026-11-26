/**
 * Built-in Context Window Limit lookup table (in tokens).
 * Ordered from most specific prefixes to general prefixes.
 */
const BUILTIN_CONTEXT_WINDOW_LIMITS: ReadonlyArray<readonly [string, number]> = [
  // Gemini 4 / Neon series
  ['gemini-4-neon', 200_000],
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

/**
 * Resolves the built-in Context Window Limit for a model name.
 * Returns null if the model is not recognized (triggering unknown-model degradation).
 */
export function resolveBuiltinContextWindowLimit(modelName: string): number | null {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return null;
  }

  for (const [prefix, limit] of BUILTIN_CONTEXT_WINDOW_LIMITS) {
    if (
      normalized === prefix ||
      normalized.startsWith(`${prefix}-`) ||
      normalized.startsWith(`${prefix}:`) ||
      normalized.startsWith(`${prefix}@`) ||
      normalized.startsWith(`${prefix}/`)
    ) {
      return limit;
    }
  }

  return null;
}
