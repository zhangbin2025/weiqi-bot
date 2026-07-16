/**
 * IP 定位服务
 * @description 通过 ip-api.com 获取用户所在省份，走 INetworkProvider 统一网络接口
 * @module services/event/IpGeoService
 */

import type { INetworkProvider } from '../../infrastructure/network/interfaces';

export interface IIpGeoService {
  /** 获取用户省份，失败返回 undefined */
  getProvince(): Promise<string | undefined>;
}

/** ip-api.com JSON 响应结构（仅取需要的字段） */
interface IpApiResponse {
  regionName?: string;
}

/**
 * IP 定位服务实现
 * 超时 5 秒，异常静默返回 undefined
 */
export class IpGeoService implements IIpGeoService {
  private readonly network: INetworkProvider;
  private readonly timeout = 5000;

  constructor(network: INetworkProvider) {
    this.network = network;
  }

  async getProvince(): Promise<string | undefined> {
    try {
      const response = await this.network.request<IpApiResponse>({
        url: 'http://ip-api.com/json/?fields=regionName',
        method: 'GET',
        timeout: this.timeout,
        responseType: 'json',
        bypassProxy: true,
      });
      const data = response.data;
      const province = data?.regionName;
      if (province) {
        console.info('IP 定位成功', { province });
      }
      return province || undefined;
    } catch (e) {
      console.warn('IP 定位失败', e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }
}
