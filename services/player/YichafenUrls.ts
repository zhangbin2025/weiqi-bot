/**
 * @fileoverview 新网站 URL 配置
 */

/** 新网站 URL 配置 */
export const YEYUWEIQI_URLS = {
  /** 基础域名 */
  BASE: 'https://yeyuweiqi.cn',
  /** 月度榜单目录 */
  RANKINGS_DIR: '/rankings/月度榜单',
  /** 月度榜单文件模板 */
  RANKINGS_FILE: '月度榜单_{{year}}_{{month}}.json',
} as const;

/** 请求头 */
export const YEYUWEIQI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': YEYUWEIQI_URLS.BASE,
} as const;

/**
 * 生成月度榜单 URL
 * @param year - 年份
 * @param month - 月份（1-12）
 * @returns 完整的 URL
 */
export function getRankingsUrl(year: number, month: number): string {
  const filename = YEYUWEIQI_URLS.RANKINGS_FILE
    .replace('{{year}}', String(year))
    .replace('{{month}}', String(month));
  return `${YEYUWEIQI_URLS.BASE}${YEYUWEIQI_URLS.RANKINGS_DIR}/${filename}`;
}

/**
 * 获取最近 N 个月的榜单文件候选列表
 * @param n - 月份数量（默认 3）
 * @returns URL 列表
 */
export function getSnapshotCandidates(n: number = 3): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 0-based
  const candidates: string[] = [];

  for (let i = 0; i < n; i++) {
    // 从上个月开始尝试，因为当前月份的榜单可能还未发布
    let m = month - i - 1;
    let y = year;
    if (m <= 0) {
      m += 12;
      y -= 1;
    }
    candidates.push(getRankingsUrl(y, m));
  }

  return candidates;
}
