/** Dedicated, disposable worker for potentially expensive regular expressions. */
import { executeRegex } from './regexCore';

interface RegexRequest {
  id: number;
  method: string;
  args: Record<string, unknown>;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RegexRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || typeof request !== 'object') return;
  try {
    scope.postMessage({ id: request.id, ok: true, value: executeRegex(request.method, request.args) });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
