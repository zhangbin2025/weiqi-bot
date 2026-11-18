/**
 * Skill 本地数据层 —— 一键装配工厂
 * @module application/skill/kv/KvKit
 *
 * 装配方（ChatPage）只调这一句：
 *   const kv = createKvKit();
 *   primitives = createSkillRegistry([...createBasicPrimitives(webTools), ...kv.primitives, ...EVENT_PRIMITIVES]);
 *   skillDeps.kvSuffix = kv.systemSuffix;
 *
 * 以后加域 / 加驱动 / 加能力都不用回来改这个文件：
 * - 加域：改 createDefaultKvDomains()；
 * - 加驱动 + 新能力：改 KvDrivers.ts / KvTypes.ts / KvPrimitives.ts 的工具表；
 * 注册表、工具集生成、system 片段全部自动跟随 capabilities() 并集。
 */

import { KvDomainRegistry, createDefaultKvDomains } from './KvDomains';
import { KvService } from './KvService';
import { createKvPrimitives, buildKvSystemSuffix } from './KvPrimitives';
import type { SkillPrimitive } from '@application/skill/SkillTypes';

export interface KvKit {
  /** 展开进宿主原语注册表 */
  primitives: SkillPrimitive[];
  /** 追加到本轮 system 尾部（工具清单与边界说明） */
  systemSuffix: string;
  /** 面板 / 宿主代码用的编程接口；不要挂进任何模型可见工具集 */
  service: KvService;
}

export function createKvKit(): KvKit {
  const registry = new KvDomainRegistry(createDefaultKvDomains());
  const service = new KvService(registry);
  return {
    primitives: createKvPrimitives(service),
    systemSuffix: buildKvSystemSuffix(service),
    service,
  };
}
