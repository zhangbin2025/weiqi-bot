import { ConfigManager } from '../core/ConfigManager';
import { ConfigStorageAdapter } from '../adapters/ConfigStorageAdapter';
import type { IKeyValueStorage } from '../../storage/interfaces/IKeyValueStorage';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let mockStorage: jest.Mocked<IKeyValueStorage>;

  beforeEach(() => {
    mockStorage = {
      read: jest.fn(),
      write: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      listKeys: jest.fn(),
      clear: jest.fn(),
    } as any;
    configManager = new ConfigManager(new ConfigStorageAdapter(mockStorage));
  });

  it('should register schema', () => {
    const schema = { key: { type: 'string', default: 'value' } };
    configManager.registerSchema('test', schema);
    expect(() => configManager.registerSchema('test', schema)).toThrow();
  });

  it('should get and set config', async () => {
    mockStorage.read.mockResolvedValue({});
    mockStorage.write.mockResolvedValue();
    
    await configManager.set('test.key', 'value');
    const result = await configManager.get('test.key');
    expect(result).toBe('value');
  });

  it('should listen to config changes', async () => {
    const listener = jest.fn();
    mockStorage.read.mockResolvedValue({});
    mockStorage.write.mockResolvedValue();

    configManager.onChange('test', listener);
    await configManager.setModuleConfig('test', { key: 'value' });
    expect(listener).toHaveBeenCalled();
  });
});
