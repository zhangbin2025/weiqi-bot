/**
 * @fileoverview 贴目值规范化
 * @module domain/game/KomiNormalizer
 * @description 将各种来源的贴目原始值转换为标准的"目"单位
 * 
 * 野狐围棋等平台的贴目值编码方式各异：
 * - 野狐 Protobuf: komi 字段是 ×10 的整数（如 75 表示 7.5 目）
 * - 野狐 SGF: KM[375] 表示 3.75 子
 * - 标准 SGF: KM[7.5] 直接是目单位
 * 
 * 转换规则：
 * 1. 值 > 50 → 毫单位，除以 100（如 375 → 3.75 子 → 7.5 目）
 * 2. 0 < 值 < 5 → 子单位，乘以 2（如 3.75 子 → 7.5 目）
 * 3. 其他 → 已经是目单位，直接使用
 * 4. 最终 round 到半整数（KataGo 要求）
 */

/**
 * 规范化贴目值
 * @param rawKomi 贴目原始值（可能是目、子、或毫单位）
 * @returns 标准化的贴目值（目单位，半整数）
 * @ai-example
 * normalizeKomi(375)   → 7.5   // 毫单位: 375/100=3.75子, 3.75*2=7.5目
 * normalizeKomi(7.5)   → 7.5   // 已经是标准目单位
 * normalizeKomi(3.75)  → 7.5   // 子单位: 3.75*2=7.5目
 * normalizeKomi(0)     → 0     // 让子棋
 * normalizeKomi(6.5)   → 6.5   // 日本规则标准贴目
 */
export function normalizeKomi(rawKomi: number): number {
  let komi = rawKomi;

  // 如果贴目值异常大（> 50），说明是毫单位，需要除以 100
  // 例如：KM[375] 表示 3.75子
  if (komi > 50) {
    komi = komi / 100;
  }

  // 如果贴目值 < 5 且 > 0，很可能是"子"单位，需要转换为"目"单位
  // 围棋规则：1 子 = 2 目
  // 例如：3.75子 = 7.5目（中国规则标准贴目）
  // 注意：KM[0] 是让子棋，不需要转换
  // 标准贴目值（目）：7.5, 6.5, 7.0, 5.5, 0（让子棋）
  if (komi < 5 && komi > 0) {
    komi = komi * 2; // 子 -> 目
  }

  // 确保 komi 是半整数或整数（符合 KataGo 要求）
  // KataGo 要求 komi 必须是整数或半整数（如 7.0, 7.5, 6.5）
  if (komi % 0.5 !== 0) {
    komi = Math.round(komi * 2) / 2; // round 到半整数
  }

  return komi;
}

/**
 * 从野狐 Protobuf 的 komi 字段计算标准贴目
 * @param protoKomi Protobuf 中的 komi 原始值（×10 编码）
 * @returns 标准化的贴目值（目单位，半整数）
 * @ai-example
 * komiFromProto(375)  → 7.5   // 375→/100=3.75子→×2=7.5目
 * komiFromProto(75)   → 7.5   // 75→/100=0.75子→×2=1.5目... 不对，75<50直接×2=150? 不对
 * komiFromProto(650)  → 6.5   // 650→/100=6.5目
 * komiFromProto(0)    → 0     // 让子棋
 */
export function komiFromProto(protoKomi: number): number {
  // 野狐 Protobuf 中 GameRule.komi 是原始 int32 值
  // 例如：375 表示 3.75 子 = 7.5 目
  // 直接传给 normalizeKomi 统一处理（>50→/100, <5→×2）
  return normalizeKomi(protoKomi);
}
