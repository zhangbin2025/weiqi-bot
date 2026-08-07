/**
 * 配置变更通知器
 */

import type { ConfigChangeListener, ConfigObject } from '../interfaces';

export class ConfigNotifier {
  private listeners: Map<string, Set<ConfigChangeListener>>;

  constructor() {
    this.listeners = new Map();
  }

  subscribe(key: string, callback: ConfigChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const listeners = this.listeners.get(key)!;
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  notify(module: string, config: ConfigObject): void {
    const moduleListeners = this.listeners.get(module);
    if (moduleListeners) {
      for (const listener of moduleListeners) {
        listener(config);
      }
    }
    for (const [key, listeners] of this.listeners.entries()) {
      if (key.startsWith(`${module}.`)) {
        const path = key.substring(module.length + 1);
        const value = this.getNestedValue(config, path);
        for (const listener of listeners) {
          listener(value);
        }
      }
    }
  }

  private getNestedValue(obj: ConfigObject, path: string): unknown {
    const keys = path.split('.');
    let value: unknown = obj;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return value;
  }
}
