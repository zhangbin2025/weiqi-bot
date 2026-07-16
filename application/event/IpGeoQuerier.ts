/**
 * IP 定位用例
 * @description 应用层编排 IP 定位流程，调用服务层
 * @module application/event/IpGeoQuerier
 */
import type { IIpGeoService } from '../../services/event/IpGeoService';
export interface IIpGeoQuerier {
  /** 获取用户所在省份，失败返回 undefined */
  fetchProvince(): Promise<string | undefined>;
}
/**
 * IP 定位 Querier（应用层）
 * 纯编排，不包含网络或业务逻辑细节
 */
export class IpGeoQuerier implements IIpGeoQuerier {
  private readonly service: IIpGeoService;
  constructor(service: IIpGeoService) {
    this.service = service;
  }
  async fetchProvince(): Promise<string | undefined> {
    return this.service.getProvince();
  }
}
