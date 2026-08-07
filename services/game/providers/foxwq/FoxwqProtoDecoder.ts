/**
 * @fileoverview 野狐围棋 WebSocket Protobuf 协议解码器
 * @description 根据野狐围棋 JS 源码中的 Protobuf 定义，解码 WebSocket 二进制消息
 * 
 * 协议链（全部来自源码 pages-Desk-index.*.js）：
 * 1. NetMessage$1.extractFromBytes → { msgTypeID, flag, rawProto }
 *    - 普通消息: [0:2]=length16, [2:4]=msgTypeID, [4]=flag, [5:end-4]=rawProto
 *    - 大消息:   [0:2]=0x7FFF, [2:4]=0x000B, [4:8]=actualLength, [8:10]=msgTypeID, [10]=flag, [11:end-4]=rawProto
 * 2. msgTypeID==26200 → 网关消息
 *    - fgwLen = BYTES_TO_SHORT(rawProto, 0)
 *    - FGWHead = rawProto[2 : fgwLen+2]
 *    - payload = rawProto[fgwLen+2 :]
 * 3. FGWHead.messageId==108 → EnterRoomWithoutLoginResponse
 * 4. roomDetail.opList.optList[] → Operation{ opType, data }
 * 5. opType==107 → game.StartSetPieceNotify.decode(data) → { rule, gameUsers, stoneMoves }
 * 6. opType==203 → game.SetPieceNotify.decode(data) → { x, y, color }
 * 7. opType==403 → game.SetGameResultNotify.decode(data) → { winner, points, reason }
 * 8. opType==609 → GC_UPDATE_FINE_ART_WIN_RATE (绝艺AI胜率)
 * 9. opType==603 → GC_ADD_REF_BRANCH_NOTIFY (绝艺AI变化图)
 */

// ========== Protobuf 基础解码 ==========

/** 读取 varint，返回 [value, newOffset] */
function readVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (offset < data.length) {
    const byte = data[offset++];
    if (byte === undefined) break;
    result |= (byte & 0x7F) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return [result, offset];
}

/** 读取大端序 uint16 */
function readUint16BE(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

/** 读取大端序 uint32 */
function readUint32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 24) | ((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
}

/** 解码 UTF-8 字节 */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

// ========== Protobuf 消息解码 ==========

interface PbField {
  fieldNum: number;
  wireType: number;
  value: number | Uint8Array;
}

/** 解码 Protobuf 消息为字段列表 */
function decodePbFields(data: Uint8Array): PbField[] {
  const fields: PbField[] = [];
  let offset = 0;

  while (offset < data.length) {
    const [tag, tagEnd] = readVarint(data, offset);
    if (tagEnd === offset) break; // 无进展

    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      // Varint
      const [value, valueEnd] = readVarint(data, tagEnd);
      fields.push({ fieldNum, wireType, value });
      offset = valueEnd;
    } else if (wireType === 2) {
      // Length-delimited
      const [length, lenEnd] = readVarint(data, tagEnd);
      const value = data.slice(lenEnd, lenEnd + length);
      fields.push({ fieldNum, wireType, value });
      offset = lenEnd + length;
    } else if (wireType === 5) {
      // 32-bit fixed
      fields.push({ fieldNum, wireType, value: 0 }); // 简化，不常用
      offset = tagEnd + 4;
    } else {
      break; // 未知 wire type
    }
  }

  return fields;
}

/** 从字段列表中获取 varint 值 */
function getVarint(fields: PbField[], fieldNum: number): number | undefined {
  const f = fields.find(f => f.fieldNum === fieldNum && f.wireType === 0);
  return f ? f.value as number : undefined;
}

/** 从字段列表中获取 bytes 值 */
function getBytes(fields: PbField[], fieldNum: number): Uint8Array | undefined {
  const f = fields.find(f => f.fieldNum === fieldNum && f.wireType === 2);
  return f ? f.value as Uint8Array : undefined;
}

/** 从字段列表中获取所有同 fieldNum 的 bytes 值（repeated） */
function getRepeatedBytes(fields: PbField[], fieldNum: number): Uint8Array[] {
  return fields.filter(f => f.fieldNum === fieldNum && f.wireType === 2).map(f => f.value as Uint8Array);
}

// ========== 业务消息类型 ==========

/** FGWHead */
export interface FgwHead {
  messageId: number;
  serverType: number;
  serverId: number;
  uid: number;
}

/** GameRule */
export interface GameRule {
  boardsize: number;
  handicap: number;
  komi: number;       // 原始值（×10），实际贴目 = komi / 10
  chessRule: number;  // 1=中国规则, 2=日本规则
  blackUid: number;
  whiteUid: number;
}

/** GameUserInfo */
export interface GameUserInfo {
  uid: number;
  nickname: string;
  grade: number;
  stoneColor: number; // 1=黑, 2=白
}

/** StoneMove (来自 StartSetPieceNotify) */
export interface StoneMove {
  flag: number;   // 1=普通, 2=Pass, 3=让子, 4=提子
  x: number;
  y: number;
  color: number;  // 1=黑, 2=白
}

/** SetPieceNotify (opType=203) */
export interface SetPieceNotify {
  x: number;
  y: number;
  color: number;  // 1=黑, 2=白
  roundNum: number;
  moveNum: number;
}

/** SetGameResultNotify (opType=403) */
export interface SetGameResultNotify {
  winner: number;  // 1=黑胜, 2=白胜
  points: number;
  reason: number;  // 1=数子, 2=超时, 3=中盘, 4=认输
}

/** 完整的直播棋谱数据 */
export interface LiveGameData {
  gameRule: GameRule | null;
  gameUsers: GameUserInfo[];
  /** 来自 StartSetPieceNotify 的棋子（让子等） */
  stoneMoves: StoneMove[];
  /** 来自 SetPieceNotify 的落子序列 */
  setPieceMoves: SetPieceNotify[];
  /** 游戏结果 */
  gameResult: SetGameResultNotify | null;
  /** 绝艺AI分析数据条数 */
  aiAnalysisCount: number;
  /** 比赛标题 */
  roomTitle: string;
  /** chessId */
  chessIdStr: string;
  /** 棋盘快照 (field 22): 361字符 '0'/'1'/'2', 悔棋后的最终局面 */
  boardState: string | null;
}

// ========== 解码函数 ==========

/** 解码 FGWHead */
function decodeFgwHead(data: Uint8Array): FgwHead {
  const fields = decodePbFields(data);
  return {
    messageId: getVarint(fields, 1) ?? 0,
    serverType: getVarint(fields, 7) ?? 0,
    serverId: getVarint(fields, 8) ?? 0,
    uid: getVarint(fields, 3) ?? 0,
  };
}

/** 解码 GameRule */
function decodeGameRule(data: Uint8Array): GameRule {
  const fields = decodePbFields(data);
  return {
    boardsize: getVarint(fields, 1) ?? 19,
    handicap: getVarint(fields, 3) ?? 0,
    komi: getVarint(fields, 4) ?? 75,
    chessRule: getVarint(fields, 9) ?? 1,
    blackUid: getVarint(fields, 5) ?? 0,
    whiteUid: getVarint(fields, 26) ?? 0,
  };
}

/** 解码 GameUserInfo */
function decodeGameUserInfo(data: Uint8Array): GameUserInfo {
  const fields = decodePbFields(data);
  const nicknameBytes = getBytes(fields, 3);
  return {
    uid: getVarint(fields, 1) ?? 0,
    nickname: nicknameBytes ? decodeUtf8(nicknameBytes) : '',
    grade: getVarint(fields, 4) ?? 0,
    stoneColor: getVarint(fields, 6) ?? 0,
  };
}

/** 解码 StoneMove */
function decodeStoneMove(data: Uint8Array): StoneMove {
  const fields = decodePbFields(data);
  return {
    flag: getVarint(fields, 1) ?? 1,
    x: getVarint(fields, 2) ?? 0,
    y: getVarint(fields, 3) ?? 0,
    color: getVarint(fields, 4) ?? 0,
  };
}

/** 解码 SetPieceNotify (opType=203) */
function decodeSetPieceNotify(data: Uint8Array): SetPieceNotify {
  const fields = decodePbFields(data);
  return {
    x: getVarint(fields, 1) ?? 0,
    y: getVarint(fields, 2) ?? 0,
    color: getVarint(fields, 3) ?? 0,
    roundNum: getVarint(fields, 8) ?? 0,
    moveNum: getVarint(fields, 9) ?? 0,
  };
}

/** 解码 SetGameResultNotify (opType=403) */
function decodeSetGameResultNotify(data: Uint8Array): SetGameResultNotify {
  const fields = decodePbFields(data);
  return {
    winner: getVarint(fields, 2) ?? 0,
    points: getVarint(fields, 3) ?? 0,
    reason: getVarint(fields, 4) ?? 0,
  };
}

/** 解码 StartSetPieceNotify (opType=107) */
function decodeStartSetPieceNotify(data: Uint8Array): {
  rule: GameRule | null;
  gameUsers: GameUserInfo[];
  stoneMoves: StoneMove[];
  chessIdStr: string;
  roomTitle: string;
  boardState: string | null;
} {
  const fields = decodePbFields(data);

  // rule (field 1)
  const ruleBytes = getBytes(fields, 1);
  const rule = ruleBytes ? decodeGameRule(ruleBytes) : null;

  // gameUsers (field 9, repeated)
  const gameUsersBytes = getRepeatedBytes(fields, 9);
  const gameUsers = gameUsersBytes.map(decodeGameUserInfo);

  // stoneMoves (field 18, repeated)
  const stoneMovesBytes = getRepeatedBytes(fields, 18);
  const stoneMoves = stoneMovesBytes.map(decodeStoneMove);

  // chessIdStr (field 8)
  const chessIdStrBytes = getBytes(fields, 8);
  const chessIdStr = chessIdStrBytes ? decodeUtf8(chessIdStrBytes) : '';

  // boardState (field 22) — 棋盘快照，361字符 '0'/'1'/'2'
  let boardState: string | null = null;
  const boardStateBytes = getBytes(fields, 22);
  if (boardStateBytes && boardStateBytes.length === 361) {
    let valid = true;
    for (let i = 0; i < 361; i++) {
      const b = boardStateBytes[i];
      if (b !== 0x30 && b !== 0x31 && b !== 0x32) { valid = false; break; }
    }
    if (valid) {
      boardState = String.fromCharCode(...boardStateBytes);
    }
  }

  // roomCfg (field 20) → roomTitle (field 1)
  let roomTitle = '';
  const roomCfgBytes = getBytes(fields, 20);
  if (roomCfgBytes) {
    const roomCfgFields = decodePbFields(roomCfgBytes);
    const titleBytes = getBytes(roomCfgFields, 1);
    if (titleBytes) roomTitle = decodeUtf8(titleBytes);
  }

  // roomTitleDynamic (field 23)
  const roomTitleDynamicBytes = getBytes(fields, 23);
  if (roomTitleDynamicBytes) {
    const dynamic = decodeUtf8(roomTitleDynamicBytes);
    if (dynamic) roomTitle = dynamic;
  }

  return { rule, gameUsers, stoneMoves, chessIdStr, roomTitle, boardState };
}

// ========== NetMessage 解码 ==========

/** NetMessage 解析结果 */
interface NetMessageResult {
  msgTypeID: number;
  rawProto: Uint8Array;
}

/**
 * 解析 NetMessage$1
 * 严格按照源码中的 extractFromBytes：
 * - 普通消息: length16 = BYTES_TO_SHORT(data, 0)
 * - 大消息:   length16 == 0x7FFF (32767)
 *   - 验证 BYTES_TO_SHORT(data, 2) == 11
 *   - actualLength = BYTES_TO_INT(data, 4)
 */
function parseNetMessage(data: Uint8Array): NetMessageResult | null {
  if (data.length <= 2) return null;

  const length16 = readUint16BE(data, 0);
  let offset = 2;
  let _actualLength: number;

  if (length16 === 32767) {
    // 大消息格式
    if (data.length <= 6) return null;
    const marker = readUint16BE(data, 2);
    if (marker !== 11) return null;
    _actualLength = readUint32BE(data, 4);
    offset = 8; // 跳过 length16(2) + marker(2) + actualLength(4)
  } else {
    _actualLength = length16;
  }

  if (_actualLength < 7 || _actualLength >= 2147483648) return null;

  const msgTypeID = readUint16BE(data, offset);
  offset += 2;

  // flag
  offset += 1;

  // rawProto = data[offset .. end-4]
  const rawProto = data.slice(offset, data.length - 4);

  return { msgTypeID, rawProto };
}

// ========== 主解码函数 ==========

/**
 * 从 WebSocket 二进制数据解码直播棋谱
 * 
 * @param data WebSocket 接收到的完整二进制消息
 * @returns 解码后的直播棋谱数据，如果数据不是有效的直播消息则返回 null
 */
export function decodeLiveGameData(data: Uint8Array): LiveGameData | null {
  // 1. 解析 NetMessage
  const netMsg = parseNetMessage(data);
  if (!netMsg) return null;

  // 2. 只处理网关消息 (msgTypeID==26200)
  if (netMsg.msgTypeID !== 26200) return null;

  // 3. 解析 FGWHead
  const fgwLen = readUint16BE(netMsg.rawProto, 0);
  const fgwHeadBytes = netMsg.rawProto.slice(2, fgwLen + 2);
  const payload = netMsg.rawProto.slice(fgwLen + 2);

  const head = decodeFgwHead(fgwHeadBytes);

  // 4. 只处理进房响应 (messageId==108)
  if (head.messageId !== 108) return null;

  // 5. 解码 EnterRoomWithoutLoginResponse
  const respFields = decodePbFields(payload);
  const roomDetailBytes = getBytes(respFields, 2); // field 2 = roomDetail
  if (!roomDetailBytes) return null;

  const roomDetailFields = decodePbFields(roomDetailBytes);
  const opListBytes = getBytes(roomDetailFields, 2); // field 2 = opList
  if (!opListBytes) return null;

  const opListFields = decodePbFields(opListBytes);
  const optListBytes = getRepeatedBytes(opListFields, 2); // field 2 = optList (repeated)

  // 6. 遍历 optList 解码每个 Operation
  const result: LiveGameData = {
    gameRule: null,
    gameUsers: [],
    stoneMoves: [],
    setPieceMoves: [],
    gameResult: null,
    aiAnalysisCount: 0,
    roomTitle: '',
    chessIdStr: '',
    boardState: null,
  };

  for (let opIdx = 0; opIdx < optListBytes.length; opIdx++) {
    const opBytes = optListBytes[opIdx]!;
    const opFields = decodePbFields(opBytes);
    const opType = getVarint(opFields, 2); // field 2 = opType
    const opData = getBytes(opFields, 3);  // field 3 = data (bytes)

    if (opType === undefined || !opData) continue;

    // DEBUG: 记录未处理的 opType
    if (opType !== 107 && opType !== 203 && opType !== 213 && opType !== 403 && opType !== 609 && opType !== 603) {
      // 仅记录，不打详细字段
    }

    try {
      if (opType === 107) {
        // GC_START_SET_PIECE_NOTIFY
        const notify = decodeStartSetPieceNotify(opData);
        if (notify.rule) result.gameRule = notify.rule;
        if (notify.gameUsers.length > 0) result.gameUsers = notify.gameUsers;
        result.stoneMoves.push(...notify.stoneMoves);
        if (notify.chessIdStr) result.chessIdStr = notify.chessIdStr;
        if (notify.roomTitle) result.roomTitle = notify.roomTitle;
        if (notify.boardState) result.boardState = notify.boardState;
      } else if (opType === 203) {
        // GC_SET_PIECE_NOTIFY
        const notify = decodeSetPieceNotify(opData);
        result.setPieceMoves.push(notify);
      } else if (opType === 213) {
        // GC_UNDO_PIECE_NOTIFY (悔棋)
        // field 2 = 悔棋手数
        const undoFields = decodePbFields(opData);
        const undoCount = getVarint(undoFields, 2) ?? 1;
        const uid = getVarint(undoFields, 1) ?? 0;
        console.info('[FoxwqProto] 悔棋操作: 回退', undoCount, '手, uid=', uid, '当前着法数:', result.setPieceMoves.length);
        // 从着法列表末尾删除 N 手
        if (undoCount > 0 && result.setPieceMoves.length >= undoCount) {
          result.setPieceMoves.splice(result.setPieceMoves.length - undoCount, undoCount);
        }
      } else if (opType === 403) {
        // GC_SET_GAME_RESULT_NOTIFY
        result.gameResult = decodeSetGameResultNotify(opData);
      } else if (opType === 609) {
        // GC_UPDATE_FINE_ART_WIN_RATE (绝艺AI胜率)
        result.aiAnalysisCount++;
      }
    } catch (e) {
      // 解码失败，跳过此 Operation
      console.warn('[FoxwqProto] opType=' + opType + ' 解码失败:', e);
    }
  }

  // 补充让子棋子：当 handicap > 0 且 stoneMoves 为空时，
  // 根据野狐前端源码中的标准让子位置自动补充
  // （野狐协议中让子棋子不在 stoneMoves 或 SetPieceNotify 里传输，
  //   前端根据 handicap 值自动摆放到标准星位）
  if (result.gameRule && result.gameRule.handicap > 0 && result.stoneMoves.length === 0) {
    const handicapStones = getStandardHandicapStones(result.gameRule.boardsize, result.gameRule.handicap);
    for (const { x, y } of handicapStones) {
      result.stoneMoves.push({ flag: 3, x, y, color: 1 }); // flag=3=E_HANDICAP
    }
  }

  // 检查是否有有效数据
  if (result.gameRule === null && result.setPieceMoves.length === 0) {
    return null;
  }

  return result;
}

/**
 * 野狐标准让子位置（来自前端源码 pages-Desk-index.*.js）
 * 源码中 pan[y][x] = 1，即黑棋(color=1)
 * 
 * 19路：
 * 2子: (15,3),(3,15) = pd,dp
 * 3子: (15,3),(3,15),(3,3) = pd,dp,dd
 * 4子: (15,3),(3,15),(3,3),(15,15) = pd,dp,dd,pp
 * 5子: + (9,9) = jj
 * 6子: + (3,9),(15,9) = dj,pj
 * 7子: + (9,9) = jj
 * 8子: + (9,3),(9,15) = jd,jp
 * 
 * 13路：
 * 2子: (9,3),(3,9) = jd,dj
 * 3子: + (3,3) = dd
 * 4子: (3,3),(3,9),(9,3),(9,9) = dd,dj,jd,jj
 * 5子: + (6,6) = gg
 * 6子: + (3,6),(9,6) = dg,jg
 * 7子: + (6,6) = gg
 * 8子: + (6,3),(6,9) = gd,gj
 * 
 * 9路：
 * 2子: (6,2),(2,6) = gc,cg
 * 3子: + (2,2) = cc
 * 4子: (2,2),(2,6),(6,2),(6,6) = cc,cg,gc,gg
 * 5子: + (6,4) = ge
 * 6子: + (2,4),(6,4) = ce,ge
 * 7子: + (4,4) = ee
 * 8子: + (4,2),(4,6) = ec,eg
 */
function getStandardHandicapStones(boardsize: number, handicap: number): Array<{ x: number; y: number }> {
  const positions: Record<number, Record<number, Array<[number, number]>>> = {
    19: {
      2: [[15, 3], [3, 15]],
      3: [[15, 3], [3, 15], [3, 3]],
      4: [[15, 3], [3, 15], [3, 3], [15, 15]],
      5: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 9]],
      6: [[15, 3], [3, 15], [3, 3], [15, 15], [3, 9], [15, 9]],
      7: [[15, 3], [3, 15], [3, 3], [15, 15], [3, 9], [15, 9], [9, 9]],
      8: [[15, 3], [3, 15], [3, 3], [15, 15], [3, 9], [15, 9], [9, 3], [9, 15]],
      9: [[15, 3], [3, 15], [3, 3], [15, 15], [3, 9], [15, 9], [9, 3], [9, 15], [9, 9]],
    },
    13: {
      2: [[9, 3], [3, 9]],
      3: [[9, 3], [3, 9], [3, 3]],
      4: [[3, 3], [3, 9], [9, 3], [9, 9]],
      5: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
      6: [[3, 3], [3, 9], [9, 3], [9, 9], [3, 6], [9, 6]],
      7: [[3, 3], [3, 9], [9, 3], [9, 9], [3, 6], [9, 6], [6, 6]],
      8: [[3, 3], [3, 9], [9, 3], [9, 9], [3, 6], [9, 6], [6, 3], [6, 9]],
    },
    9: {
      2: [[6, 2], [2, 6]],
      3: [[6, 2], [2, 6], [2, 2]],
      4: [[2, 2], [2, 6], [6, 2], [6, 6]],
      5: [[2, 2], [2, 6], [6, 2], [6, 6], [6, 4]],
      6: [[2, 2], [2, 6], [6, 2], [6, 6], [2, 4], [6, 4]],
      7: [[2, 2], [2, 6], [6, 2], [6, 6], [2, 4], [6, 4], [4, 4]],
      8: [[2, 2], [2, 6], [6, 2], [6, 6], [2, 4], [6, 4], [4, 2], [4, 6]],
    },
  };

  const sizeMap = positions[boardsize];
  if (!sizeMap) return [];
  const stones = sizeMap[handicap];
  if (!stones) return [];

  return stones.map(([x, y]) => ({ x, y }));
}

/**
 * 从 messageId=102 (RoomDetail) 消息中提取用户颜色映射
 * 
 * 野狐直播间中，messageId=102 (RoomDetail) 的 field 3 -> field 2 里的用户信息
 * 包含正确的执子颜色（field 8: 1=黑, 2=白）。
 * 
 * 而 messageId=108 (EnterRoom) -> opType=107 中的 gameUsers.stoneColor (field 6)
 * 在直播间场景下可能是反的。
 * 
 * @returns uid -> stoneColor 的映射（1=黑, 2=白）
 */
function extractRoomDetailPlayerColors(messages: Uint8Array[]): Map<number, number> {
  const colorMap = new Map<number, number>();

  for (const data of messages) {
    if (data.length < 100) continue;

    const netMsg = parseNetMessage(data);
    if (!netMsg || netMsg.msgTypeID !== 26200) continue;

    const fgwLen = readUint16BE(netMsg.rawProto, 0);
    const fgwHeadBytes = netMsg.rawProto.slice(2, fgwLen + 2);
    const payload = netMsg.rawProto.slice(fgwLen + 2);
    const head = decodeFgwHead(fgwHeadBytes);

    if (head.messageId !== 102) continue;

    // payload: field 3 = roomInfo, roomInfo.field 2 = users (repeated)
    const respFields = decodePbFields(payload);
    const roomInfoBytes = getBytes(respFields, 3);
    if (!roomInfoBytes) continue;

    const roomFields = decodePbFields(roomInfoBytes);
    const usersBytes = getRepeatedBytes(roomFields, 2);

    for (const userBytes of usersBytes) {
      const userFields = decodePbFields(userBytes);
      const uid = getVarint(userFields, 1);
      const stoneColor = getVarint(userFields, 8); // field 8 = color (1=black, 2=white)
      if (uid && stoneColor) {
        colorMap.set(uid, stoneColor);
      }
    }

    if (colorMap.size >= 2) break;
  }

  return colorMap;
}

/**
 * 从多条 WebSocket 消息中解码直播棋谱
 * 自动找到最大的消息（通常是进房响应）进行解码
 * 
 * 同时从 messageId=102 (RoomDetail) 消息中提取正确的玩家颜色信息，
 * 覆盖 messageId=108 中可能错误的 stoneColor
 * 
 * @param messages WebSocket 消息列表
 * @returns 解码后的直播棋谱数据，如果没有有效消息则返回 null
 */
export function decodeLiveGameDataFromMessages(messages: Uint8Array[]): LiveGameData | null {
  // 1. 从 RoomDetail (messageId=102) 提取正确的玩家颜色映射
  const roomDetailColors = extractRoomDetailPlayerColors(messages);

  // 2. 按大小降序排列，优先解码最大的消息
  const sorted = messages
    .map((data, index) => ({ data, size: data.length, index }))
    .sort((a, b) => b.size - a.size);

  for (const { data, size } of sorted) {
    if (size < 100) continue;
    const result = decodeLiveGameData(data);
    if (result) {
      // 3. 用 RoomDetail 的颜色覆盖 StartSetPieceNotify 中可能错误的 stoneColor
      if (roomDetailColors.size >= 2 && result.gameUsers.length >= 2) {
        for (const user of result.gameUsers) {
          const correctColor = roomDetailColors.get(user.uid);
          if (correctColor !== undefined && correctColor !== user.stoneColor) {
            console.info('[FoxwqProto] fix player color: ' + user.nickname + ' uid=' + user.uid + ' stoneColor ' + user.stoneColor + ' -> ' + correctColor);
            user.stoneColor = correctColor;
          }
        }
      }
      return result;
    }
  }

  return null;
}
