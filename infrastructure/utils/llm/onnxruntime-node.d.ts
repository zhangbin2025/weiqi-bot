/**
 * ONNX Runtime Node 类型声明
 * @description 为可选依赖 onnxruntime-node 提供类型声明
 */

declare module 'onnxruntime-node' {
  export interface InferenceSession {
    run(inputs: Record<string, any>): Promise<Record<string, any>>;
    release(): Promise<void>;
  }

  export interface InferenceSessionOptions {
    executionProviders?: ('cpu' | 'cuda' | 'dml')[];
  }

  export const InferenceSession: {
    create(modelPath: string, options?: InferenceSessionOptions): Promise<InferenceSession>;
  };
}
