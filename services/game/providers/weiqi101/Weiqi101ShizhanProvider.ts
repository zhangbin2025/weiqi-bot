/**
 * @fileoverview 101围棋网实战题（shizhan）提供者
 * @description 仅 CLI 模式使用，需通过环境变量提供认证信息：
 *   WEIQI101_CSRFTOKEN / WEIQI101_SESSIONID / WEIQI101_X_CSRFTOKEN
 * 复用现有 Weiqi101SgfGenerator + buildTsumegoMinBoard 将题目转换为死活题 SGF。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { Weiqi101QuestionData } from './Weiqi101Parser';
import { Weiqi101SgfGenerator } from './Weiqi101SgfGenerator';
import { buildTsumegoMinBoard } from '../../../../domain/sgf';

const WEIQI101_BASE_URL = 'https://www.101weiqi.com';

const ENV_CSRFTOKEN = 'WEIQI101_CSRFTOKEN';
const ENV_SESSIONID = 'WEIQI101_SESSIONID';
const ENV_X_CSRFTOKEN = 'WEIQI101_X_CSRFTOKEN';

const SHIZHAN_SGF_GENERATOR = new Weiqi101SgfGenerator();

/**
 * 解密 101 加密字段（base64 + XOR）
 * key 规则：'101' + i + i + i，其中 i = String(ru + 1)
 */
function decryptShizhanField(encryptedBase64: string, ru?: number): any {
  if (!encryptedBase64 || ru == null || ru < 1 || ru > 2) {
    try {
      return JSON.parse(encryptedBase64);
    } catch {
      return null;
    }
  }
  const i = String(ru + 1);
  const key = '101' + i + i + i;
  const buf = Buffer.from(encryptedBase64, 'base64');
  const bytes: number[] = [];
  for (let k = 0; k < buf.length; k++) {
    bytes.push(buf[k]! ^ key.charCodeAt(k % key.length));
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * 将 101 实战题 qq 对象转换为死活题 SGF（最小棋盘）。
 * 独立导出，供 Provider 与 CLI 脚本复用。
 */
export function convertShizhanQQToSgf(qq: any): string {
  const contentRaw = decryptShizhanField(qq.content, qq.ru);
  const content: [string[], string[]] = Array.isArray(contentRaw)
    ? (contentRaw as [string[], string[]])
    : [[], []];

  const prepos: [string[], string[]] = Array.isArray(qq.prepos)
    ? (qq.prepos as [string[], string[]])
    : [[], []];

  // content 通常已包含完整初始局面（prepos 为其子集），合并去重确保幂等
  const uniq = (arr: string[]) => Array.from(new Set(arr));
  const blackStones = uniq([...(content[0] || []), ...(prepos[0] || [])]);
  const whiteStones = uniq([...(content[1] || []), ...(prepos[1] || [])]);

  const questionData: Weiqi101QuestionData = {
    qid: qq.qid,
    publicid: qq.publicid || 0,
    name: qq.name || '',
    levelname: qq.levelname || '',
    qtypename: qq.qtypename || '棋理题',
    blackfirst: qq.blackfirst ?? true,
    content: [blackStones, whiteStones],
    answers: (qq.answers || []).map((a: any) => ({
      pts: a.pts || [],
      st: a.st ?? 0,
      ty: a.ty ?? 1,
      nu: a.nu,
      username: a.username,
    })),
    lu: qq.lu || 19,
  };

  const sgfRaw = SHIZHAN_SGF_GENERATOR.generateQuestion(questionData);
  const minBoard = buildTsumegoMinBoard(sgfRaw);
  return minBoard ? minBoard.sgf : sgfRaw;
}

/** 从 SGF 头部提取 SZ 尺寸 */
function extractMinSize(sgf: string): number {
  const m = sgf.match(/SZ\[(\d+)\]/);
  return m && m[1] ? parseInt(m[1], 10) : 19;
}

/**
 * 101围棋网实战题（shizhan）提供者
 */
export class Weiqi101ShizhanProvider extends BaseProvider {
  readonly name = 'weiqi101-shizhan';
  readonly displayName = '101围棋网实战题';
  readonly urlPatterns = [
    /101weiqi\.com\/shizhan\/question\/(next|prev)\/\d+\/\d+\/\d+/,
    /101weiqi\.cn\/shizhan\/question\/(next|prev)\/\d+\/\d+\/\d+/,
  ];

  /** 从环境变量读取认证头；缺失则抛出清晰错误 */
  private getAuthHeaders(): Record<string, string> {
    const csrfToken = process.env[ENV_CSRFTOKEN];
    const sessionId = process.env[ENV_SESSIONID];
    const xCsrfToken = process.env[ENV_X_CSRFTOKEN];

    if (!csrfToken || !sessionId || !xCsrfToken) {
      throw new Error(
        '缺少 101 围棋网认证环境变量，请在运行前设置：\n' +
        `  export ${ENV_CSRFTOKEN}=<csrftoken>\n` +
        `  export ${ENV_SESSIONID}=<sessionid>\n` +
        `  export ${ENV_X_CSRFTOKEN}=<x-csrftoken>`
      );
    }

    const cookie = `csrftoken=${csrfToken}; sessionid=${sessionId}`;
    return {
      'Cookie': cookie,
      'X-CSRFToken': xCsrfToken,
      'Referer': WEIQI101_BASE_URL + '/shizhan/record/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    try {
      const headers = this.getAuthHeaders();
      const apiUrl = url.startsWith('http') ? url : WEIQI101_BASE_URL + url;

      const response = await this.network.request<string>({
        url: apiUrl,
        method: 'GET',
        responseType: 'text',
        headers,
      });

      timing.apiRequest = this.now() - startTime;

      const json = JSON.parse(response.data);
      const pagedata = json.pagedata;
      if (!pagedata || !pagedata.qq) {
        return this.createErrorResult(url, '响应中缺少 pagedata.qq', timing);
      }

      const sgfContent = convertShizhanQQToSgf(pagedata.qq);
      timing.sgfGeneration = this.now() - startTime - (timing.apiRequest || 0);
      timing.total = this.now() - startTime;

      const qq = pagedata.qq;
      const minSize = extractMinSize(sgfContent);

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId: String(qq.qid),
          blackName: qq.name,
          whiteName: qq.levelname + ' ' + qq.qtypename,
          blackRank: qq.levelname,
          whiteRank: '',
          width: minSize,
          height: minSize,
          komi: 0,
          handicap: 0,
          rules: 'chinese',
          date: '',
          result: '',
          movesCount: qq.answers && qq.answers[0] ? (qq.answers[0].pts?.length || 0) : 0,
        },
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        '实战题下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing
      );
    }
  }
}
