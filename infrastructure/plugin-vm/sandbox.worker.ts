/**
 * 插件沙箱 Worker 入口
 * @module infrastructure/plugin-vm/sandbox.worker
 *
 * 运行在独立 Worker 线程，只有结构化克隆消息，没有页面 DOM 与凭据。
 * 收到 init → 加载 wasm → warmup → ready；收到 run → 执行 → 回传结果。
 */

import { QuickJsExecutor } from './QuickJsExecutor';
import type { PluginSpec, PluginRunResult } from '../../domain/plugin/types';

interface InitMessage { type: 'init'; wasmBinary: ArrayBuffer }
interface RunMessage { type: 'run'; code: string; input: unknown; spec: PluginSpec }
type InboundMessage = InitMessage | RunMessage;

let executor: QuickJsExecutor | null = null;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') {
    executor = new QuickJsExecutor({ wasmBinary: msg.wasmBinary });
    void executor.warmup().then(
      () => scope.postMessage({ type: 'ready' }),
      (error: unknown) => scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }
  if (msg.type === 'run') {
    if (!executor) {
      scope.postMessage({ type: 'error', message: '沙箱尚未初始化' });
      return;
    }
    void executor.execute({ code: msg.code, input: msg.input, spec: msg.spec }).then(
      (result: PluginRunResult) => scope.postMessage({ type: 'result', result }),
      (error: unknown) => scope.postMessage({
        type: 'result',
        result: {
          ok: false,
          phase: 'crash',
          error: { name: 'SandboxError', message: error instanceof Error ? error.message : String(error) },
          logs: [],
          elapsedMs: 0,
        } satisfies PluginRunResult,
      }),
    );
  }
};
