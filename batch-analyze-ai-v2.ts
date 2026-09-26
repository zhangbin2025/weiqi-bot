/**
 * batch-analyze-ai-v2.ts
 * 
 * 带SGF缓存的批量分析脚本。
 * 如果 /tmp/strength-calibration/sgf/ 已有SGF文件，直接用缓存，跳过下载。
 * 
 * 用法：
 *   npx tsx batch-analyze-ai-v2.ts --password *** [--debug]
 */

import * as fs from 'fs';
import * as path from 'path';
import { NetworkManager } from './infrastructure/network/core/NetworkManager';
import { DirectProvider } from './infrastructure/network/adapters/cli/DirectProvider';
import { UserType } from './infrastructure/network/interfaces/UserType';
import { FoxwqUserProvider } from './services/game/providers/foxwq/FoxwqUserProvider';
import { FoxwqChessProvider } from './services/game/providers/foxwq/FoxwqChessProvider';
import { CliRemoteKataGoEngine } from './clients/cli/remote-runtime';
import { AIController } from './services/ai/AIController';
import { ReviewService } from './services/review/ReviewService';
import { SGFParser } from './domain/sgf/SGFParser';
import { estimateStrength } from './services/strength';
import type { StrengthSource } from './services/strength/types';

const args = process.argv.slice(2);
let password = '222222';
let signaling = 'wss://api.weiqi.lol/ws/signal';
let debug = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--password' && args[i + 1]) password = args[++i];
  else if (args[i] === '--signaling' && args[i + 1]) signaling = args[++i];
  else if (args[i] === '--debug') debug = true;
}

const TARGET = '隐弈世界';
const MIN_MOVES = 30;
const OUTPUT_DIR = '/tmp/strength-calibration';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'ai-games-analysis-v2.json');
const SGF_DIR = path.join(OUTPUT_DIR, 'sgf');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function ensureConnected(engine: CliRemoteKataGoEngine, ai: AIController): Promise<void> {
  // @ts-ignore
  const tunnel = engine.tunnel;
  if (tunnel && tunnel.isConnected) return;
  console.log('[batch] 隧道断开，尝试重连...');
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log('[batch] 重连尝试 ' + attempt + '/' + MAX_RETRIES);
      await ai.init('g170-b10c128', '/models/g170-b10c128.bin.gz');
      // @ts-ignore
      if (engine.tunnel && engine.tunnel.isConnected) {
        console.log('[batch] 重连成功');
        return;
      }
    } catch (e) {
      console.log('[batch] 重连失败: ' + (e instanceof Error ? e.message : String(e)));
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
  }
  throw new Error('重连失败，已尝试 ' + MAX_RETRIES + ' 次');
}

async function main() {
  const network = new NetworkManager({ defaultTimeout: 30000, retryCount: 2 } as any);
  network.setUserContext({
    getUserType: async () => UserType.GUEST,
    hasPaidToken: async () => false,
    getAuthToken: async () => null,
    hasPermission: async () => false,
  });
  network.registerProvider(new DirectProvider());

  const userProvider = new FoxwqUserProvider(network);
  const chessProvider = new FoxwqChessProvider(network);

  const user = await userProvider.queryUserByName(TARGET);
  console.log('[batch] ' + TARGET + ' UID=' + user.uid + ' dan=' + user.dan);

  // 抓棋谱列表
  const allGames: any[] = [];
  let lastcode = '0';
  while (allGames.length < 100) {
    const games: any = await chessProvider.fetchChessList(user.uid, lastcode);
    if (!games || games.length === 0) break;
    allGames.push(...games);
    lastcode = games[games.length - 1].code || games[games.length - 1].chessid;
    if (games.length < 20) break;
  }
  console.log('[batch] 共获取 ' + allGames.length + ' 盘棋谱');

  // 筛选AI对手 + 过滤短局
  const aiGames: any[] = [];
  for (const g of allGames) {
    const isBlack = g.blacknick === TARGET;
    const oppAi = isBlack ? g.white_ai : g.black_ai;
    if (oppAi !== 1) continue;
    const movenum = g.movenum || 0;
    if (movenum < MIN_MOVES) continue;
    aiGames.push(g);
  }
  console.log('[batch] 筛选AI对手棋谱: ' + aiGames.length + ' 盘');

  // 检查已有结果（跳过已分析的棋谱）
  const existingResults: any[] = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      existingResults.push(...old);
    } catch {}
  }
  const doneChessids = new Set(existingResults.filter(r => !r.error).map(r => r.chessid));
  const toAnalyze = aiGames.filter(g => !doneChessids.has(g.chessid));
  console.log('[batch] 已分析: ' + doneChessids.size + ' 盘，待分析: ' + toAnalyze.length + ' 盘');

  if (toAnalyze.length === 0) {
    console.log('[batch] 全部已分析，直接输出汇总');
    const results = existingResults;
    printSummary(results);
    return;
  }

  // 连接KataGo
  const engine = new CliRemoteKataGoEngine(signaling, password, debug);
  if (debug) console.error('[batch] 连接远程KataGo服务端...');
  const ai = new AIController(engine);
  await ai.init('g170-b10c128', '/models/g170-b10c128.bin.gz');
  let engineInfo = engine.getEngineInfo();
  console.log('[batch] 引擎就绪: ' + JSON.stringify(engineInfo));

  const sgfParser = new SGFParser();
  const reviewService = new ReviewService(ai, sgfParser);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(SGF_DIR, { recursive: true });
  const results: any[] = [...existingResults];

  for (let i = 0; i < toAnalyze.length; i++) {
    const g = toAnalyze[i];
    const isBlack = g.blacknick === TARGET;
    const oppName = isBlack ? g.whitenick : g.blacknick;
    const oppDan = isBlack ? g.whitedan : g.blackdan;
    const movenum = g.movenum;
    const chessid = g.chessid;

    console.log('\n[batch] ===== 第 ' + (i + 1) + '/' + toAnalyze.length + ' 盘 (总第' + (results.length + 1) + '盘) =====');
    console.log('[batch] chessid=' + chessid + ' 对手=' + oppName + '(dan=' + oppDan + ',AI) 手数=' + movenum);

    try {
      await ensureConnected(engine, ai);
      engineInfo = engine.getEngineInfo();

      // 优先用缓存的SGF
      const sgfPath = path.join(SGF_DIR, chessid + '.sgf');
      let sgf: string;
      if (fs.existsSync(sgfPath)) {
        sgf = fs.readFileSync(sgfPath, 'utf-8');
        console.log('[batch] 使用缓存SGF');
      } else {
        sgf = await chessProvider.fetchSGF(chessid);
        if (!sgf || sgf.length < 50) {
          console.log('[batch] SGF内容为空，跳过');
          continue;
        }
        fs.writeFileSync(sgfPath, sgf, 'utf-8');
      }

      const reviewId = await reviewService.loadFromSGF(sgf);

      const isNative = engineInfo.backend === 'native';
      const visits = isNative ? 1 : 0;
      await reviewService.analyzeGameBatch(reviewId, { visits, mode: 'quick' }, {
        onProgress: (p) => {
          process.stderr.write('\r[batch] 进度 ' + (p.current ?? 0) + '/' + (p.total ?? 0) + ' (' + (p.percentage ?? 0) + '%)');
        },
      });
      process.stderr.write('\n');

      const fullMoves = reviewService.getFullMoves(reviewId);
      if (!fullMoves) {
        console.log('[batch] 无分析结果，跳过');
        reviewService.destroy(reviewId);
        continue;
      }

      const source: StrengthSource = {
        kind: 'live',
        moves: fullMoves,
        blackName: g.blacknick,
        whiteName: g.whitenick,
      };
      const strengthReport = estimateStrength(source);

      const aiColor = isBlack ? 'white' : 'black';
      const aiEstimate = aiColor === 'black' ? strengthReport.black : strengthReport.white;
      const humanEstimate = aiColor === 'black' ? strengthReport.white : strengthReport.black;

      const record = {
        index: results.length + 1,
        chessid,
        date: g.starttime,
        movenum,
        blackName: g.blacknick,
        blackDan: g.blackdan,
        whiteName: g.whitenick,
        whiteDan: g.whitedan,
        aiName: oppName,
        aiDan: oppDan,
        aiColor,
        winner: g.winner === 1 ? 'black' : g.winner === 2 ? 'white' : 'draw',
        aiStrength: {
          score: aiEstimate.score,
          foxDan: aiEstimate.foxDan,
          label: aiEstimate.label,
          confidence: aiEstimate.confidence,
          hasCandidateData: aiEstimate.hasCandidateData,
          signals: aiEstimate.signals,
        },
        humanStrength: {
          score: humanEstimate.score,
          foxDan: humanEstimate.foxDan,
          label: humanEstimate.label,
          confidence: humanEstimate.confidence,
          hasCandidateData: humanEstimate.hasCandidateData,
          signals: humanEstimate.signals,
        },
      };

      // 替换已有记录（如果有）
      const existIdx = results.findIndex(r => r.chessid === chessid);
      if (existIdx >= 0) results[existIdx] = record;
      else results.push(record);

      console.log('[batch] AI: score=' + aiEstimate.score + ' ' + aiEstimate.label + ' (实际dan=' + oppDan + ')');
      console.log('[batch] 信号: sm=' + aiEstimate.signals.smoothness.toFixed(3) + ' st=' + aiEstimate.signals.stability.toFixed(3) + ' ld=' + aiEstimate.signals.largeDropRate.toFixed(3) + ' m=' + aiEstimate.signals.mistakeRate.toFixed(3) + ' vol=' + aiEstimate.signals.volatility.toFixed(3));

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
      reviewService.destroy(reviewId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log('[batch] 失败: ' + errMsg);
      if (errMsg.includes('隧道') || errMsg.includes('P2P') || errMsg.includes('连接')) {
        try { await ensureConnected(engine, ai); } catch {}
      }
      const existIdx = results.findIndex(r => r.chessid === chessid);
      const failRecord = { index: results.length + 1, chessid, date: g.starttime, movenum, aiName: oppName, aiDan: oppDan, error: errMsg };
      if (existIdx >= 0) results[existIdx] = failRecord;
      else results.push(failRecord);
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
    }
  }

  engine.disconnect();
  printSummary(results);
}

function printSummary(results: any[]) {
  const ok = results.filter(r => !r.error);
  const fail = results.filter(r => r.error);
  console.log('\n========== 汇总 ==========');
  console.log('总盘数: ' + results.length + ' 成功: ' + ok.length + ' 失败: ' + fail.length);

  const byDan: Record<number, any[]> = {};
  for (const r of ok) {
    const dan = r.aiDan;
    if (!byDan[dan]) byDan[dan] = [];
    byDan[dan].push(r);
  }

  console.log('\n=== 按AI段位分组 ===');
  console.log('dan\tn\tscore\tsm\tst\tld\tm\tsv\tvol\tscore_range');
  for (const dan of Object.keys(byDan).sort((a, b) => Number(a) - Number(b))) {
    const group = byDan[Number(dan)];
    const n = group.length;
    const avg = (k1: string, k2?: string) => {
      const path = k2 ? k1 + '.' + k2 : k1;
      return group.reduce((s, r) => {
        const parts = path.split('.');
        let v: any = r;
        for (const p of parts) v = v?.[p];
        return s + (v ?? 0);
      }, 0) / n;
    };
    const scores = group.map(r => r.aiStrength.score);
    console.log(dan + '\t' + n + '\t' + avg('aiStrength.score').toFixed(1) + '\t' +
      avg('aiStrength.signals.smoothness').toFixed(3) + '\t' +
      avg('aiStrength.signals.stability').toFixed(3) + '\t' +
      avg('aiStrength.signals.largeDropRate').toFixed(3) + '\t' +
      avg('aiStrength.signals.mistakeRate').toFixed(3) + '\t' +
      avg('aiStrength.signals.severeRate').toFixed(3) + '\t' +
      avg('aiStrength.signals.volatility').toFixed(3) + '\t' +
      Math.min(...scores) + '-' + Math.max(...scores));
  }
  console.log('\n[batch] 结果保存到: ' + OUTPUT_FILE);
}

main().catch(e => { console.error('[batch] 致命错误:', e); process.exit(1); });
