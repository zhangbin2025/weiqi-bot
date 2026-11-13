/**
 * QuickJS 执行核心（纯逻辑，不依赖 Worker/DOM）
 * @module infrastructure/plugin-vm/QuickJsExecutor
 *
 * 这是沙箱的「引擎」：把 wasm 二进制喂给 QuickJS variant，每次执行创建
 * 独立的 Runtime + Context，注入白名单 hostApi 与输入，调用约定入口，
 * 返回纯 JSON 结果或结构化诊断。
 *
 * 宿主层（QuickJsRuntime）负责把它放进一次性 Worker 并加硬超时；
 * 本文件刻意不引用任何浏览器 Worker API，因此可以在 Node/vitest 里直接测。
 */

import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import type {
  PluginSpec,
  PluginRunResult,
  PluginError,
  PluginLimits,
} from '../../domain/plugin/types';

/** 构造 QuickJS 模块所需的 wasm 字节（由宿主注入，避免依赖路径解析） */
export type WasmBinaryProvider = () => Promise<ArrayBuffer>;

export interface QuickJsExecutorOptions {
  wasmBinary: ArrayBuffer | WasmBinaryProvider;
}

/** 一次执行的输入 */
export interface ExecuteInput {
  code: string;
  input: unknown;
  spec: PluginSpec;
}

/** 把 VM 抛出的任意值归一成 PluginError */
function toPluginError(dumped: unknown, fallback: string): PluginError {
  if (dumped && typeof dumped === 'object') {
    const obj = dumped as Record<string, unknown>;
    return {
      name: typeof obj['name'] === 'string' ? obj['name'] : 'Error',
      message: typeof obj['message'] === 'string' ? obj['message'] : fallback,
      ...(typeof obj['stack'] === 'string' ? { stack: obj['stack'] } : {}),
      ...(typeof obj['lineNumber'] === 'number' ? { lineNumber: obj['lineNumber'] } : {}),
    };
  }
  return { name: 'Error', message: typeof dumped === 'string' ? dumped : fallback };
}

/** 判断诊断是否属于某类资源失败 */
function classifyPhase(error: PluginError): 'oom' | 'timeout' | 'runtime' | 'compile' {
  if (error.name === 'InternalError' && /out of memory/i.test(error.message)) return 'oom';
  if (error.name === 'InternalError' && /interrupted/i.test(error.message)) return 'timeout';
  return 'runtime';
}

export class QuickJsExecutor {
  private modulePromise: Promise<QuickJSWASMModule> | null = null;

  constructor(private readonly options: QuickJsExecutorOptions) {}

  private async getModule(): Promise<QuickJSWASMModule> {
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        const provider = this.options.wasmBinary;
        const binary = typeof provider === 'function' ? await provider() : provider;
        // 关键：用 wasmBinary 直接喂字节，绕开 import.meta.url 在 es2015
        // 降级 / Android 静态服务下解析失败的问题（项目 OCR 侧踩过同类坑）。
        const variant = newVariant(RELEASE_SYNC, { wasmBinary: binary });
        return newQuickJSWASMModuleFromVariant(variant);
      })();
    }
    return this.modulePromise;
  }

  /** 预加载（Worker 启动时调用，避免首轮执行把加载时间算进超时） */
  async warmup(): Promise<void> {
    await this.getModule();
  }

  async execute({ code, input, spec }: ExecuteInput): Promise<PluginRunResult> {
    const started = Date.now();
    const logs: string[] = [];
    let module: QuickJSWASMModule;
    try {
      module = await this.getModule();
    } catch (error) {
      return {
        ok: false,
        phase: 'crash',
        error: { name: 'VmLoadError', message: error instanceof Error ? error.message : String(error) },
        hint: '沙箱引擎加载失败，请检查 wasm 资源是否完整',
        logs,
        elapsedMs: Date.now() - started,
      };
    }

    const limits: PluginLimits = spec.limits;
    const rt = module.newRuntime();
    rt.setMemoryLimit(limits.memoryBytes);
    rt.setMaxStackSize(limits.maxStackBytes);
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs));

    const ctx = rt.newContext();
    try {
      // 1) 注入 hostApi 白名单（默认空 → 沙箱零能力）
      for (const name of spec.hostApi) {
        const fn = ctx.newFunction(name, (...args) => {
          if (logs.length < limits.maxLogs) {
            try {
              logs.push(`${name}:${args.map((a) => String(ctx.dump(a))).join(',')}`);
            } catch {
              logs.push(`${name}:<unprintable>`);
            }
          }
          return ctx.undefined;
        });
        ctx.setProp(ctx.global, name, fn);
        fn.dispose();
      }

      // 2) 输入只以 JSON 字符串形式进入，不给宿主对象引用
      const inputJson = JSON.stringify(input ?? null);
      const inputHandle = ctx.newString(inputJson);
      ctx.setProp(ctx.global, '__PLUGIN_INPUT__', inputHandle);
      inputHandle.dispose();

      // 3) 定义插件代码
      const def = ctx.evalCode(code, 'plugin.js');
      if (def.error) {
        const error = toPluginError(ctx.dump(def.error), '插件代码编译失败');
        def.error.dispose();
        return {
          ok: false,
          phase: 'compile',
          error,
          hint: '代码存在语法错误，请根据行号修正后输出完整代码',
          logs,
          elapsedMs: Date.now() - started,
        };
      }
      def.value.dispose();

      // 4) 调用约定入口
      const entry = spec.entry;
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)) {
        return {
          ok: false,
          phase: 'contract',
          error: { name: 'ContractError', message: `非法入口名: ${entry}` },
          logs,
          elapsedMs: Date.now() - started,
        };
      }
      const call = ctx.evalCode(
        `JSON.stringify(${entry}(JSON.parse(__PLUGIN_INPUT__)))`,
        '__entry__.js',
      );
      if (call.error) {
        const dumped = ctx.dump(call.error);
        const error = toPluginError(dumped, '插件运行失败');
        call.error.dispose();
        const phase = classifyPhase(error);
        return {
          ok: false,
          phase,
          error,
          hint:
            phase === 'oom' ? '插件超出内存配额，请减少中间数据'
              : phase === 'timeout' ? '插件执行超时（可能有死循环），请简化逻辑'
                : '运行时报错，请根据调用栈修正后输出完整代码',
          logs,
          elapsedMs: Date.now() - started,
        };
      }

      const outStr = ctx.dump(call.value);
      call.value.dispose();
      if (typeof outStr !== 'string') {
        return {
          ok: false,
          phase: 'contract',
          error: { name: 'ContractError', message: '入口函数未返回可序列化结果' },
          contract: { entryFound: true, outputIsArray: false, missingFields: [] },
          hint: '入口函数必须返回可 JSON 序列化的 { columns, rows } 对象',
          logs,
          elapsedMs: Date.now() - started,
        };
      }
      if (outStr.length > limits.maxOutputBytes) {
        return {
          ok: false,
          phase: 'contract',
          error: { name: 'ContractError', message: `输出超出 ${limits.maxOutputBytes} 字节上限` },
          hint: '请只返回必要的排名表列与行',
          logs,
          elapsedMs: Date.now() - started,
        };
      }
      let output: unknown;
      try {
        output = JSON.parse(outStr) as unknown;
      } catch {
        return {
          ok: false,
          phase: 'contract',
          error: { name: 'ContractError', message: '入口返回值无法序列化为 JSON' },
          hint: '不要返回循环引用 / 函数 / BigInt',
          logs,
          elapsedMs: Date.now() - started,
        };
      }
      return { ok: true, output, logs, elapsedMs: Date.now() - started };
    } finally {
      ctx.dispose();
      rt.dispose();
    }
  }
}
