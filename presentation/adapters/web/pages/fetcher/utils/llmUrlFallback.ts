/**
 * Unsupported game URL → LLM chat deep link.
 *
 * Only a true "no provider matched" result may fall back. A provider that matched
 * but failed to fetch must keep its original error so authentication/network errors
 * are not hidden behind an unrelated LLM attempt.
 */
export function shouldDelegateUnsupportedUrlToLlm(
  source: string | undefined,
  llmConfigured: boolean,
): boolean {
  return source === 'unknown' && llmConfigured;
}

/** Build a same-origin chat-page URL, preserving the application's deployment path. */
export function buildLlmUrlTaskHref(currentHref: string, gameUrl: string): string {
  const target = new URL('../assistant/chat.html', currentHref);
  target.searchParams.set('url', gameUrl);
  return target.toString();
}
