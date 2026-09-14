/**
 * @fileoverview 弈客围棋直播列表 Provider
 *
 * 通过弈客公开 API 获取正在直播的对局列表，不需要登录。
 * API: https://api.yikeweiqi.com/v2/golive/list?p=1&since=0&official=1&version=2&usertoken=-1
 *
 * 需要签名头，算法如下：
 *   nonce = random(0, 1e8)
 *   timestamp = Date.now()
 *   curtime = Date.now()
 *   CheckSum = SHA1(appSecret + nonce + curtime)
 *   accesstoken = MD5("@1%e$5*f@3" + MD5(timestamp) + "web")
 *
 * 返回的 Id 即为房间号，构造 mobile URL 供 YikeProvider 抓取：
 * https://home.yikeweiqi.com/mobile.html#/golive/room/{Id}/0/0
 */

import * as crypto from "crypto";
import type { LatestGameItem } from "../../../../application/fetcher/types";
import type { NetworkManager } from "../../../../infrastructure/network/core/NetworkManager";

/** 弈客直播 API 响应 */
interface YikeLiveListResponse {
  Status: number;
  Result: {
    since: number;
    list: YikeLiveGame[];
  };
  Message?: string;
}

/** 弈客直播对局 */
interface YikeLiveGame {
  Id: number;
  GameName: string;
  BlackName: string;
  WhiteName: string;
  GameDate: string;
  BroadcastTime: string;
  HandsCount: number;
  Status: number;
  GameResult: string;
}

const YIKE_LIVE_API = "https://api.yikeweiqi.com/v2/golive/list";
const APP_KEY = "3396jtzhK57XhJom";
const APP_SECRET = "hfdSXRKm0DQyLmNXmNCNkZpjy2o5q1Hk";
const SALT = "@1%e$5*f@3";

/**
 * 生成弈客 API 签名头
 */
function buildSignHeaders(): Record<string, string> {
  const nonce = Math.round(Math.random() * 1e8).toString();
  const timestamp = Date.now().toString();
  const curtime = Date.now().toString();

  const md5Timestamp = crypto.createHash("md5").update(timestamp).digest("hex").toLowerCase();
  const accesstoken = crypto.createHash("md5").update(SALT + md5Timestamp + "web").digest("hex").toLowerCase();
  const checksum = crypto.createHash("sha1").update(APP_SECRET + nonce + curtime).digest("hex").toLowerCase();

  return {
    "AppKey": APP_KEY,
    "CurTime": curtime,
    "CheckSum": checksum,
    "Nonce": nonce,
    "accesstoken": accesstoken,
    "usertoken": "-1",
    "version": "96813",
    "Platform": "web",
    "timestamp": timestamp,
    "uuid": "web",
    "accept-language": "zh-cn",
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://home.yikeweiqi.com/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

/**
 * 弈客围棋直播列表 Provider
 *
 * 使用 NetworkManager 发起请求（支持代理），通过签名头认证。
 */
export class YikeLiveProvider {
  readonly name = "yike-live";

  constructor(private readonly network?: NetworkManager) {}

  /**
   * 获取弈客直播棋谱列表
   * @param count - 获取数量
   * @param keyword - 关键词筛选（棋手名、赛事名）
   * @returns LatestGameItem 列表
   */
  async fetchLiveGames(count: number = 20, keyword?: string): Promise<LatestGameItem[]> {
    const apiUrl = `${YIKE_LIVE_API}?p=1&since=0&official=1&version=2&usertoken=-1`;
    const headers = buildSignHeaders();

    let data: YikeLiveListResponse;

    if (this.network) {
      const response = await this.network.request<YikeLiveListResponse>({
        url: apiUrl,
        method: "GET",
        headers,
      });
      data = response.data as unknown as YikeLiveListResponse;
    } else {
      const resp = await fetch(apiUrl, { method: "GET", headers });
      if (!resp.ok) {
        throw new Error(`弈客直播 API 返回 ${resp.status}`);
      }
      data = await resp.json() as YikeLiveListResponse;
    }

    if (data.Status !== 1200 || !data.Result?.list) {
      throw new Error(`弈客直播 API 返回异常: Status=${data.Status}, Message=${data.Message ?? ""}`);
    }

    let games = data.Result.list;

    // 关键词过滤
    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      games = games.filter(
        (g) =>
          g.BlackName?.toLowerCase().includes(kw) ||
          g.WhiteName?.toLowerCase().includes(kw) ||
          g.GameName?.toLowerCase().includes(kw),
      );
    }

    return games.slice(0, count).map((g) => ({
      source: "yike-live",
      title: this.formatTitle(g),
      subtitle: g.GameResult ? `已结束: ${g.GameResult}` : `进行中 ${g.HandsCount}手`,
      date: g.GameDate || "",
      url: `https://home.yikeweiqi.com/mobile.html#/golive/room/${g.Id}/0/0`,
    }));
  }

  private formatTitle(g: YikeLiveGame): string {
    const name = g.GameName || "Friendly Match";
    return `${name} | ${g.BlackName} vs ${g.WhiteName}`;
  }
}
