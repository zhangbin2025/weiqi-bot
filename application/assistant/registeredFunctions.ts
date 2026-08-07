// registeredFunctions.ts - 已注册的 AI 函数定义
import type { AIFunction } from './types';
import { playFunctions } from './functions-play';
import { josekiFunctions } from './functions-joseki';
import { analysisFunctions } from './functions-analysis';
import { subscriptionFunctions } from './functions-subscription';
/** 已注册的 AI 函数列表 */
export const registeredFunctions: AIFunction[] = [
  ...playFunctions,
  ...josekiFunctions,
  ...analysisFunctions,
  ...subscriptionFunctions,
];