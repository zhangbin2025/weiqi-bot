import { describe, expect, it } from 'vitest';
import {
  buildLlmUrlTaskHref,
  shouldDelegateUnsupportedUrlToLlm,
} from '../llmUrlFallback';

describe('unsupported URL LLM fallback', () => {
  it('only delegates when no provider matched and LLM is configured', () => {
    expect(shouldDelegateUnsupportedUrlToLlm('unknown', true)).toBe(true);
    expect(shouldDelegateUnsupportedUrlToLlm('unknown', false)).toBe(false);
    expect(shouldDelegateUnsupportedUrlToLlm('ogs', true)).toBe(false);
    expect(shouldDelegateUnsupportedUrlToLlm('error', true)).toBe(false);
    // Recognized platforms that are unavailable in this runtime must not be delegated.
    expect(shouldDelegateUnsupportedUrlToLlm('unavailable', true)).toBe(false);
  });

  it('creates a chat deep link and preserves the original URL as a query value', () => {
    const original = 'https://example.org/game?id=12&view=full';
    const href = buildLlmUrlTaskHref('https://bot.example/fetcher/index.html', original);
    const parsed = new URL(href);
    expect(parsed.pathname).toBe('/assistant/chat.html');
    expect(parsed.searchParams.get('url')).toBe(original);
  });

  it('preserves a nested application base path', () => {
    const href = buildLlmUrlTaskHref('https://bot.example/app/fetcher/index.html', 'https://example.org/a');
    expect(new URL(href).pathname).toBe('/app/assistant/chat.html');
  });
});
