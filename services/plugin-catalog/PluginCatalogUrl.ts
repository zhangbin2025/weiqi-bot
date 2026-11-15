/**
 * 插件源 URL 校验（单一出处）
 * @module services/plugin-catalog/PluginCatalogUrl
 *
 * 在 `validateWebFetchUrl`（http/https + 拒绝环回/私网字面地址，见
 * application/chat/WebFetchTool.ts）之上再加一条：**自定义源必须 https**。
 *
 * 理由不是「https 更安全」这种泛泛之谈，而是具体攻击面：清单与插件源码都走
 * 明文 http 时，中间人可替换 `plugin.json.code` 指向的源码正文，用户看到的
 * 仍是同一个资源名。虽然最终代码只在 QuickJS 零能力沙箱里跑、安装前还会
 * 静态预检 + 试跑、且默认停用需人工启用，但没必要为自定义源开这个口子。
 * GitHub Pages 官方默认源本身就是 https，不受影响。
 *
 * 「只放行 https」是明说的业务约束，不是从数据扫出来的阈值。
 */

import { validateWebFetchUrl } from '@application/chat/WebFetchTool';

/** 校验并规范化一个 registry 源 URL；非法直接抛错，由 UI 转成一行提示 */
export function validateRegistryUrl(raw: string): string {
  const url = validateWebFetchUrl(raw.trim());
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('插件源必须使用 https（明文 http 可能被替换源码）');
  }
  return url;
}
