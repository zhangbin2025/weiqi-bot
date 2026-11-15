/**
 * 用户消息轮次序号（纯宿主状态，不落盘、不设阈值）。
 * @module application/skill/SkillTurn
 *
 * 用途：给「写操作必须等用户下一条消息确认」提供一条结构性轮次边界。
 * ToolLoop 在同一条用户消息里会连续决策，模型可能 parse 出草稿后立刻自动
 * commit；仅靠 prompt 要求「等确认」不足以保证。ChatUseCase 在每条用户消息
 * 开始时调用 beginUserTurn()，写操作原语比较预览生成时的序号与当前序号。
 *
 * 这是计数，不是计时器、不是打分、不是超时：没有可调参数，也不引入新常量。
 */

let userTurnSeq = 0;

/** 每条用户消息推进一次 */
export function beginUserTurn(): void {
  userTurnSeq += 1;
}

/** 当前轮次序号 */
export function currentUserTurn(): number {
  return userTurnSeq;
}
