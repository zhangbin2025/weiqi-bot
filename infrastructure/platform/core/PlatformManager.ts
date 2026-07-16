import type { IPlatformAdapter, PlatformType, PlatformCapabilities } from '../interfaces';

/**
 * 平台管理器
 * @description 注册和管理多个平台适配器
 * 
 * @ai-example
 * ```typescript
 * const manager = new PlatformManager();
 * manager.register(new ReactNativeAdapter());
 * manager.register(new ElectronAdapter());
 * 
 * const adapter = manager.detectCurrent();
 * console.log('Current:', adapter?.name);
 * ```
 */
export class PlatformManager {
  private adapters: Map<PlatformType, IPlatformAdapter> = new Map();

  /**
   * 注册平台适配器
   */
  register(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * 获取指定平台的适配器
   */
  get(name: PlatformType): IPlatformAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 检测当前平台并返回适配器
   */
  detectCurrent(): IPlatformAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.isCurrentPlatform()) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * 获取所有已注册的平台
   */
  getAll(): IPlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * 获取当前平台能力
   */
  getCurrentCapabilities(): PlatformCapabilities | undefined {
    const adapter = this.detectCurrent();
    return adapter?.getCapabilities();
  }
}
