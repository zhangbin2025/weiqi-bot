/**
 * LLM 客户端单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnnxClient } from '../OnnxClient';
import { ApiClient } from '../ApiClient';
import { LocalKeywordClient } from '../LocalKeywordClient';
import { LLMClientFactory } from '../LLMClientFactory';
import type { LLMConfig } from '../types';

describe('OnnxClient', () => {
  let client: OnnxClient;

  beforeEach(() => {
    // 使用模拟路径创建客户端
    client = new OnnxClient('/path/to/model.onnx');
  });

  it('should create OnnxClient instance', () => {
    expect(client).toBeInstanceOf(OnnxClient);
  });

  it('should classify intent by keywords', async () => {
    const result = await client.classifyIntent('我想下棋');

    expect(result).toHaveProperty('intent');
    expect(result).toHaveProperty('confidence');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should recognize download_game intent', async () => {
    const result = await client.classifyIntent('请帮我下载这个棋谱');

    expect(result.intent).toBe('download_game');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should extract entities from text', async () => {
    const result = await client.extractEntities('查询柯洁的战绩', 'query_player');

    expect(result).toHaveProperty('entities');
    expect(result.entities).toHaveProperty('player');
  });

  it('should check availability', async () => {
    const available = await client.isAvailable();

    expect(typeof available).toBe('boolean');
  });
});

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient({
      endpoint: 'http://localhost:5000',
      timeout: 1000,
    });
  });

  it('should create ApiClient instance', () => {
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('should check availability (will fail without server)', async () => {
    const available = await client.isAvailable();

    // 在没有服务器的情况下，应该返回 false
    expect(available).toBe(false);
  });

  it('should extract entities locally when API unavailable', async () => {
    const result = await client.extractEntities('查询柯洁的战绩', 'query_player');

    expect(result).toHaveProperty('entities');
    // 本地提取应该能够识别棋手名
    expect(result.entities.player).toBe('柯洁');
  });
});

describe('LLMClientFactory', () => {
  it('should create OnnxClient', () => {
    const config: LLMConfig = {
      provider: 'onnx',
      modelPath: '/path/to/model.onnx',
    };

    const client = LLMClientFactory.create(config);

    expect(client).toBeInstanceOf(OnnxClient);
  });

  it('should create ApiClient', () => {
    const config: LLMConfig = {
      provider: 'api',
      endpoint: 'http://localhost:5000',
    };

    const client = LLMClientFactory.create(config);

    expect(client).toBeInstanceOf(ApiClient);
  });

  it('should throw error for missing modelPath', () => {
    const config: LLMConfig = {
      provider: 'onnx',
    };

    expect(() => LLMClientFactory.create(config)).toThrow('modelPath is required');
  });

  it('should throw error for missing endpoint', () => {
    const config: LLMConfig = {
      provider: 'api',
    };

    expect(() => LLMClientFactory.create(config)).toThrow('endpoint is required');
  });

  it('should throw error for unknown provider', () => {
    const config = {
      provider: 'unknown',
    } as any;

    expect(() => LLMClientFactory.create(config)).toThrow('Unknown LLM provider');
  });

  it('should create default client', () => {
    const client = LLMClientFactory.createDefault();

    // 默认客户端是 LocalKeywordClient（本地关键词匹配）
    expect(client).toBeInstanceOf(LocalKeywordClient);
  });
});
