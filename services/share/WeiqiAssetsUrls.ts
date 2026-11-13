/**
 * weiqi-assets 资源的稳定 URL
 * @module services/share/WeiqiAssetsUrls
 *
 * weiqi-assets 已转型为 weiqi-bot 的开放扩展资源库（插件工件 + LLM 工具声明，
 * 见其 registry.json），并同时托管 SGF 二维码分享的站点能力。
 *
 * 收敛到这里的理由：以后换域名 / 换部署方式 / 换路径只改一处，不必在
 * fetcher / replay / puzzle 三个入口里逐个找硬编码字符串。
 *
 * URL 契约来源：
 * - 站点根、share 着陆页：weiqi-assets/share/README.md
 * - 两处 decodeUrl 一致性由 weiqi-assets/scripts/validate.mjs 校验
 * - 旧硬编码值：本仓库 commit 前 ShareService.ts 与三个页面入口的同一字符串
 *
 * 旧二维码兼容性按需求明确不予考虑；换路径时两仓同步改，并跑一遍校验与单测。
 */

/** weiqi-assets 站点根（GitHub Pages） */
export const WEIQI_ASSETS_BASE_URL = 'https://weiqi-dev.github.io/weiqi-assets/';

/**
 * SGF 分享二维码指向的解码着陆页。
 * 生成规则：此值 + '?d=' + GameEncoder 输出的 URL-safe Base64。
 * 与 weiqi-assets/share/share.js 的 config.decodeUrl 必须一致。
 */
export const WEIQI_SHARE_DECODE_URL = `${WEIQI_ASSETS_BASE_URL}share/`;

/** 顶层资源清单入口（扩展资源下载用，当前宿主尚未接入） */
export const WEIQI_ASSETS_REGISTRY_URL = `${WEIQI_ASSETS_BASE_URL}registry.json`;
