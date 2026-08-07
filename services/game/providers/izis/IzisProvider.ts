/**
 * @fileoverview izis围棋提供者实现
 *
 * 优先直接 HTTP POST 调用 getdataserver API 获取棋谱数据。
 * - Node.js 环境：使用 http 模块（无 CORS 限制）
 * - 浏览器环境：通过代理服务器转发（解决 CORS）
 * 当直接调用失败时，fallback 到 Sniffer 拦截模式。
 */

import { BaseProvider } from "../base/BaseProvider";
import type { FetchResult, PerformanceTiming } from "../base/types";
import type { IIzisProvider } from "./IIzisProvider";
import type { NetworkManager } from "../../../../infrastructure/network/core/NetworkManager";
import type { ISnifferProvider } from "../../../../infrastructure/network/interfaces/ISnifferProvider";
import type { HttpResponseData } from "../../../../infrastructure/network/interfaces/SnifferTypes";
import { IzisParser } from "./IzisParser";

/** izis API 基础 URL */
const IZIS_API_URL = "http://app.izis.cn/GoWebService/getdataserver";

/**
 * 检测是否为 Node.js 环境
 */
function isNodeEnv(): boolean {
  try { return typeof process !== "undefined" && process.versions?.node != null; } catch { return false; }
}

/**
 * 直接调用 izis API（跨平台：Node.js 用 http，浏览器走代理）
 */
async function callIzisApi(gameId: number, type: number = 2, proxyUrl?: string): Promise<any> {
  const requestBody = JSON.stringify({
    code: "190105",
    info: JSON.stringify({ root: [{ gameid: gameId, type, state: 1 }] }),
    snum: "",
    userid: 0,
  });

  if (isNodeEnv()) {
    // Node.js: 使用 http 模块（无 CORS 限制）
    const http = await import("http");
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "app.izis.cn",
          path: "/GoWebService/getdataserver",
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(requestBody),
            Origin: "http://app.izis.cn",
            Referer: "http://app.izis.cn/web/",
          },
        },
        (res: any) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("izis API 响应解析失败: " + data.substring(0, 200)));
            }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error("izis API 请求超时"));
      });
      req.write(requestBody);
      req.end();
    });
  } else {
    // 浏览器: 通过代理服务器转发（解决 CORS）
    // 代理格式与 ProxyProvider 一致：${proxyUrl}/?url=${encodeURIComponent(targetUrl)}
    const targetUrl = proxyUrl
      ? `${proxyUrl}/?url=${encodeURIComponent(IZIS_API_URL)}`
      : IZIS_API_URL;

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`izis API 请求失败: ${response.status}`);
    }

    return response.json();
  }
}

/**
 * izis围棋提供者
 */
export class IzisProvider extends BaseProvider implements IIzisProvider {
  readonly name = "izis";
  readonly displayName = "隐智智能棋盘";
  readonly urlPatterns = [
    /izis\.cn.*gameId=(\d+)/,
    /app\.izis\.cn.*gameId=(\d+)/,
  ];

  private readonly parser = new IzisParser();
  private readonly sniffer?: ISnifferProvider | undefined;
  private readonly proxyUrl?: string | undefined;

  constructor(
    network: NetworkManager,
    sniffer?: ISnifferProvider,
    proxyUrl?: string
  ) {
    super(network);
    this.sniffer = sniffer;
    this.proxyUrl = proxyUrl;
  }

  async fetchByGameId(gameId: string): Promise<void> {
    const url = `http://app.izis.cn/web/#/live_detail?gameId=${gameId}&type=2`;
    await this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, "无法从 URL 提取游戏 ID", timing);
    }

    // 1. 优先直接 HTTP API 调用（跨平台，无需 Sniffer）
    try {
      const directResult = await this.fetchDirectApi(gameId, url, timing, startTime);
      if (directResult) return directResult;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.info("[IzisProvider] 直接 API 调用失败，尝试 Sniffer fallback:", errMsg);
    }

    // 2. Fallback: Sniffer 模式（仅当 Sniffer 可用时）
    if (this.sniffer?.isAvailable()) {
      return this.fetchViaSniffer(gameId, url, timing, startTime);
    }

    return this.createErrorResult(url, "直接 API 调用失败，且 Sniffer 不可用", timing);
  }

  private async fetchDirectApi(
    gameId: string,
    url: string,
    timing: PerformanceTiming,
    startTime: number
  ): Promise<FetchResult | null> {
    const fetchStart = this.now();
    const apiData = await callIzisApi(parseInt(gameId, 10), 2, this.proxyUrl);
    timing.apiRequest = this.now() - fetchStart;

    if (!apiData || apiData.error !== 0 || !apiData.data) {
      return null;
    }

    const data = apiData.data;
    const metadata = this.parser.buildMetadata(data, gameId);
    metadata.isLive = data.f_state === 0;
    metadata.isEnded = data.f_state !== 0;

    const moves = this.parser.parseMoves(
      (data.f_allstep as string) || "",
      metadata.width
    );

    const sgfStart = this.now();
    const sgfContent = this.parser.generateSgf(metadata, moves);
    timing.sgfGeneration = this.now() - sgfStart;
    timing.total = this.now() - startTime;

    return {
      success: true,
      source: this.name,
      url,
      sgfContent,
      metadata,
      timing,
    };
  }

  private async fetchViaSniffer(
    gameId: string,
    url: string,
    timing: PerformanceTiming,
    startTime: number
  ): Promise<FetchResult> {
    if (!this.sniffer) {
      return this.createErrorResult(url, "Sniffer 不可用", timing);
    }

    try {
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 10000,
        httpPattern: "getdataserver",
      });

      const apiResponses: { error?: number; data?: Record<string, unknown> }[] = [];

      session.onMessage((msg) => {
        if (msg.type === "http_response") {
          try {
            const httpMsg = msg as HttpResponseData;
            if (httpMsg.url.includes("getdataserver") && httpMsg.status === 200 && httpMsg.body) {
              apiResponses.push(JSON.parse(httpMsg.body));
            }
          } catch {}
        }
      });

      const result = await session.wait(10000);
      timing.apiRequest = this.now() - fetchStart;

      if (!result.success) {
        return this.createErrorResult(url, result.error || "Sniffer 抓取数据失败", timing);
      }

      const allMessages = session.getMessages();
      for (const msg of allMessages) {
        if (msg.type === "http_response") {
          try {
            const httpMsg = msg as HttpResponseData;
            if (httpMsg.url.includes("getdataserver") && httpMsg.status === 200 && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (!apiResponses.some((r) => JSON.stringify(r) === JSON.stringify(data))) {
                apiResponses.push(data);
              }
            }
          } catch {}
        }
      }

      if (apiResponses.length === 0) {
        return this.createErrorResult(url, "未捕获到 API 响应", timing);
      }

      const apiData = apiResponses.find((r) => r.error === 0) || apiResponses[0];
      if (!apiData) {
        throw new Error("无法获取棋谱数据");
      }

      const data = apiData.data || {};
      const metadata = this.parser.buildMetadata(data, gameId);
      metadata.isLive = data["f_state"] === 0;
      metadata.isEnded = data["f_state"] !== 0;
      const moves = this.parser.parseMoves(
        (data["f_allstep"] as string) || "",
        metadata.width
      );

      const sgfStart = this.now();
      const sgfContent = this.parser.generateSgf(metadata, moves);
      timing.sgfGeneration = this.now() - sgfStart;
      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata,
        timing,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        `获取失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }
}
