/**
 * @fileoverview 数据映射函数
 * @description 将 API 响应数据映射到领域类型（赛事服务）
 */

import type { Event, Group, Player, Match } from './types';

/**
 * 映射比赛数据
 */
export const mapEvent = (r: Record<string, unknown>): Event => ({
  id: Number(r['event_id']),
  title: String(r['title'] || ''),
  city: String(r['city_name'] || ''),
  date: r['max_time'] ? String(r['max_time']).substring(0, 10) : null,
  players: Number(r['play_num']) || 0,
});

/**
 * 映射分组数据
 */
export const mapGroup = (r: Record<string, unknown>): Group => ({
  id: Number(r['group_id']),
  name: String(r['groupname'] || ''),
  players: Number(r['playernum'] ?? r['participant_count']) || null,
});

/**
 * 映射选手数据
 */
export const mapPlayer = (r: Record<string, unknown>): Player => {
  const result: Player = {
    id: Number(r['participant_id']),
    name: String(r['participantname'] || ''),
  };
  if (r['rank_num']) result.rank = String(r['rank_num']);
  if (r['integral']) result.score = Number(r['integral']);
  return result;
};

/**
 * 映射对阵数据
 */
export const mapMatch = (r: Record<string, unknown>, bout: number): Match => ({
  bout,
  p1Id: Number(r['p1id']) || 0,
  p1Name: String(r['p1'] || ''),
  p1Score: Number(r['p1_score']) || 0,
  p2Id: Number(r['p2id']) || 0,
  p2Name: String(r['p2'] || ''),
  p2Score: Number(r['p2_score']) || 0,
});

/**
 * 检查轮次是否已完成
 */
export const isRoundCompleted = (rows: Match[]): boolean =>
  rows.some((m) => m.p1Score !== 0 || m.p2Score !== 0);
