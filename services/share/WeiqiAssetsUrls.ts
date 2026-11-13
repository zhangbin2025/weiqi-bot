/**
 * weiqi-assets 资源的稳定 URL
 * @module services/share/WeiqiAssetsUrls
 *
 * weiqi-assets 从「SGF 二维码分享库」扩展为 weiqi-bot 的开放扩展资源库
 * （插件工件 + LLM 工具声明，见其 registry.json）。但 js/share.js 与 share/
 * 这两个路径是**冻结的**：二维码一旦生成、打印、转发，URL 就无法召回，
 * 改路径会让所有历史二维码失效。因此它们不参与资源库目录整改。
 *
 * 收敛到这里的理由：以后换域名 / 换部署方式只改一处，不必在
 * fetcher / replay / puzzle 三个入口里逐个找硬编码字符串。
 *
 * 数值与路径来源：
 * - 站点根、share 着陆页：weiqi-assets/README.md「为什么 js/ 和 share/ 不动」
 * - 旧硬编码值：本仓库 commit 前 ShareService.ts 与三个页面入口的同一字符串
 */

/** weiqi-assets 站点根（GitHub Pages） */
export const WEIQI_ASSETS_BASE_URL = 'https://weiqi-dev.github.io/weiqi-assets/';

/**
 * SGF 分享二维码指向的解码着陆页。
 * 生成规则：此值 + '?d=' + GameEncoder 输出的 URL-safe Base64。
 * 与 weiqi-assets/js/share.js 的 config.decodeUrl 必须一致。
 */
export const WEIQI_SHARE_DECODE_URL = `${WEIQI_ASSETS_BASE_URL}share/`;

/** 顶层资源清单入口（扩展资源下载用，当前宿主尚未接入） */
export const WEIQI_ASSETS_REGISTRY_URL = `${WEIQI_ASSETS_BASE_URL}registry.json`;
