import { describe, it, expect, vi, beforeEach } from "vitest";
import { FoxwqPublicProvider } from "../FoxwqPublicProvider";
import type { NetworkManager } from "../../../../infrastructure/network/core/NetworkManager";
import type { IResponse } from "../../../../infrastructure/network/interfaces";

describe("FoxwqPublicProvider", () => {
  let provider: FoxwqPublicProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;

    provider = new FoxwqPublicProvider(mockNetwork);
  });

  describe("fetchPublicQipuList", () => {
    it("should parse new H5 share links from HTML", async () => {
      const html = `
        <table class="table table-hover qipu-table">
          <tr>
            <td>
              <h4 class="qipu-title">
                <a href="https://h5.foxwq.com/yehunewshare/?chessid=1784523343010001684&title=测试棋谱">第28届农心杯 屠晓宇执白2.5目胜丁浩</a>
              </h4>
            </td>
            <td class="qipu-time text-right">2026-07-20 12:55</td>
          </tr>
          <tr>
            <td>
              <h4 class="qipu-title">
                <a href="https://h5.foxwq.com/yehunewshare/?chessid=1784523021010001642&title=另一盘">2026韩国挑战联赛</a>
              </h4>
            </td>
            <td class="qipu-time text-right">2026-07-20 12:50</td>
          </tr>
        </table>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuList();

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("第28届农心杯 屠晓宇执白2.5目胜丁浩");
      expect(result[0].url).toBe(
        "https://h5.foxwq.com/yehunewshare/?chessid=1784523343010001684&title=测试棋谱"
      );
      expect(result[0].date).toBe("2026-07-20");
    });

    it("should filter by date", async () => {
      const html = `
        <tr>
          <td>
            <h4 class="qipu-title">
              <a href="https://h5.foxwq.com/yehunewshare/?chessid=123">第1局</a>
            </h4>
          </td>
          <td class="qipu-time">2026-07-20 12:00</td>
        </tr>
        <tr>
          <td>
            <h4 class="qipu-title">
              <a href="https://h5.foxwq.com/yehunewshare/?chessid=456">第2局</a>
            </h4>
          </td>
          <td class="qipu-time">2026-07-19 12:00</td>
        </tr>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuList("2026-07-20");

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-07-20");
    });
  });

  describe("fetchPublicQipuSgf", () => {
    it("should extract chessid and call API", async () => {
      const mockSgf = "(;GM[1]FF[4]SZ[19]GN[测试棋谱]DT[2026-07-20])";
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: {
          result: 0,
          chess: mockSgf,
        },
        status: 200,
      } as IResponse<{ result: number; chess: string }>);

      const result = await provider.fetchPublicQipuSgf(
        "https://h5.foxwq.com/yehunewshare/?chessid=1784523343010001684"
      );

      expect(result.sgf).toBe(mockSgf);
      expect(result.title).toBe("测试棋谱");
      expect(result.date).toBe("2026-07-20");

      // 验证调用了正确的API
      expect(mockNetwork.request).toHaveBeenCalledWith({
        url: expect.stringContaining("YHWQFetchChess?chessid=1784523343010001684"),
        method: "GET",
      });
    });

    it("should throw error if chessid not found", async () => {
      await expect(
        provider.fetchPublicQipuSgf("https://h5.foxwq.com/yehunewshare/")
      ).rejects.toThrow("无法从URL中提取棋谱ID");
    });
  });
});
