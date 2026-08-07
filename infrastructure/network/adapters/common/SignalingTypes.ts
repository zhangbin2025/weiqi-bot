/**
 * 信令消息数据类型
 */

import type { RTCIceCandidateInit, RTCSessionDescriptionInit } from '../../interfaces';

/**
 * Offer 消息数据
 */
export interface IOfferMessageData {
  type: 'offer';
  sdp?: string;
}

/**
 * Answer 消息数据
 */
export interface IAnswerMessageData {
  type: 'answer';
  sdp?: string;
}

/**
 * ICE 消息数据
 */
export interface IIceMessageData extends RTCIceCandidateInit {}

/**
 * 信令消息数据（联合类型）
 */
export type SignalingMessageData =
  | IOfferMessageData
  | IAnswerMessageData
  | IIceMessageData
  | unknown;
