/**
 * 分享语义回归：fetcher 页面所有分享操作分享的都是「链接」，不是 SGF 内容
 * @module application/fetcher/__tests__/FetcherShareLink
 * @description
 *   决策（2026-10-21）：二维码分享 = 分享链接（含内置库 lib:// 链接），
 *   不重新编码 SGF。菜单文案明确写「分享链接」。
 */
import { describe, it, expect, vi } from 'vitest';
import { FetcherApp } from '../FetcherApp';
import type { IGameService } from '../../../services/game';
import type { IExportService } from '../../../services/export';
import type { IFavoriteService } from '../../../services/favorite';
import type { IShareService } from '../../../services/share';
import { actionText } from '../../../presentation/adapters/web/pages/fetcher/utils/gameKind';

const SGF = '(;GM[1]FF[4]SZ[19]KM[7.5]PB[柯洁]PW[申真谞];B[pd];W[dp];B[pp];W[dd])';

function makeGameService(archiveUrl?: string): IGameService {
  return {
    fetch: vi.fn(),
    getByArchiveId: vi.fn().mockResolvedValue(SGF),
    getArchiveIndex: vi.fn().mockResolvedValue(
      archiveUrl ? { metadata: { url: archiveUrl } } : null,
    ),
  } as unknown as IGameService;
}

function makeShareService(): IShareService {
  return {
    baseUrl: 'https://weiqi-dev.github.io/weiqi-assets/share/',
    generateShareUrl: vi.fn().mockReturnValue('https://weiqi-dev.github.io/weiqi-assets/share/?d=ENCODED'),
    decodeShareUrl: vi.fn(),
    decodeParam: vi.fn(),
    toSGF: vi.fn(),
  } as unknown as IShareService;
}

function buildApp(gameService: IGameService, shareService: IShareService) {
  const exportService = { exportSGF: vi.fn(), exportHistory: vi.fn(), exportJSON: vi.fn() } as unknown as IExportService;
  const favoriteService = { addFavorite: vi.fn(), getFavorites: vi.fn(), clear: vi.fn(), removeFavorite: vi.fn(), isFavorited: vi.fn() } as unknown as IFavoriteService;
  return new FetcherApp(gameService, exportService, favoriteService, shareService);
}

describe('分享链接语义', () => {
  it('菜单文案明确是「分享链接」，不再是「分享」', () => {
    expect(actionText('share')).toBe('分享链接');
  });

  it('在线来源：直接分享来源 URL，不编码 SGF', async () => {
    const url = 'https://foxwq.com/qipu/12345';
    const gameService = makeGameService(url);
    const shareService = makeShareService();
    const app = buildApp(gameService, shareService);

    const r = await app.generateShareUrl('arch-1');

    expect(r.success).toBe(true);
    expect(r.shareUrl).toBe(url);
    // 分享的是链接 → 不该去读 SGF、不该走编码
    expect(gameService.getByArchiveId).not.toHaveBeenCalled();
    expect(shareService.generateShareUrl).not.toHaveBeenCalled();
  });

  it('内置棋谱库 lib:// 链接：同样是分享对象', async () => {
    const url = 'lib://life-and-death/2026-10-12/0';
    const gameService = makeGameService(url);
    const shareService = makeShareService();
    const app = buildApp(gameService, shareService);

    const r = await app.generateShareUrl('arch-1');

    expect(r.success).toBe(true);
    expect(r.shareUrl).toBe(url);
    expect(gameService.getByArchiveId).not.toHaveBeenCalled();
  });

  it('显式传入 sourceUrl 时优先用它，连归档索引都不查', async () => {
    const gameService = makeGameService('https://should-not-be-used.example/x');
    const shareService = makeShareService();
    const app = buildApp(gameService, shareService);

    const r = await app.generateShareUrl('arch-1', 'lib://ai-review/2026-10-13/0');

    expect(r.shareUrl).toBe('lib://ai-review/2026-10-13/0');
    expect(gameService.getArchiveIndex).not.toHaveBeenCalled();
  });

  it('无可分享链接（archive: 本地导入）才回退到 SGF 编码', async () => {
    const gameService = makeGameService('archive:' + Buffer.from(SGF).toString('base64'));
    const shareService = makeShareService();
    const app = buildApp(gameService, shareService);

    const r = await app.generateShareUrl('arch-1');

    expect(r.success).toBe(true);
    expect(r.shareUrl).toContain('?d=');
    expect(gameService.getByArchiveId).toHaveBeenCalledWith('arch-1');
    expect(shareService.generateShareUrl).toHaveBeenCalled();
  });

  it('归档无 URL 记录时也回退到 SGF 编码', async () => {
    const gameService = makeGameService(undefined);
    const shareService = makeShareService();
    const app = buildApp(gameService, shareService);

    const r = await app.generateShareUrl('arch-1');

    expect(r.success).toBe(true);
    expect(r.shareUrl).toContain('?d=');
  });
});
