/**
 * AuthManager 单元测试
 * @module infrastructure/auth/__tests__/AuthManager.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthManager } from '../AuthManager';
import type { IAuthManager } from '../IAuthManager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

// Mock fetch
const fetchMock = vi.fn();

// Mock window
vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('fetch', fetchMock);

// Mock document.createElement for script loading
const scriptMock = {
  src: '',
  crossOrigin: '',
  onload: null as (() => void) | null,
  onerror: null as (() => void) | null,
  remove: vi.fn(),
};

vi.stubGlobal('document', {
  head: {
    appendChild: vi.fn((script: typeof scriptMock) => {
      // Simulate successful load
      setTimeout(() => {
        (window as { API_BASE?: string }).API_BASE = 'https://api.test.com';
        script.onload?.();
      }, 0);
    }),
  },
  createElement: vi.fn(() => scriptMock),
});

vi.stubGlobal('window', {
  API_BASE: undefined,
});

describe('AuthManager', () => {
  let auth: IAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    fetchMock.mockReset();
    auth = new AuthManager();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('getToken / saveToken / clearToken', () => {
    it('should return null when no token', () => {
      expect(auth.getToken()).toBeNull();
    });

    it('should save and get token', () => {
      auth.saveToken('test-token-123');
      expect(auth.getToken()).toBe('test-token-123');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('weiqi_token', 'test-token-123');
    });

    it('should clear token', () => {
      auth.saveToken('test-token');
      auth.clearToken();
      expect(auth.getToken()).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('weiqi_token');
    });

    it('should reject token with invalid chars', () => {
      auth.saveToken('test-中文字符');
      expect(auth.getToken()).toBeNull();
    });

    it('should load token from localStorage on init', () => {
      localStorageMock.setItem('weiqi_token', 'stored-token');
      const auth2 = new AuthManager();
      expect(auth2.getToken()).toBe('stored-token');
    });
  });

  describe('hasToken', () => {
    it('should return false when no token', () => {
      expect(auth.hasToken()).toBe(false);
    });

    it('should return true when has token', () => {
      auth.saveToken('test-token');
      expect(auth.hasToken()).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('should return false when no token', async () => {
      const result = await auth.validateToken();
      expect(result).toBe(false);
    });

    it('should return true when API returns ok', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
      auth.saveToken('valid-token');

      const result = await auth.validateToken();

      expect(fetchMock).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when API returns 401', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
      auth.saveToken('invalid-token');

      const result = await auth.validateToken();

      expect(result).toBe(false);
      expect(auth.status).toBe('expired');
    });

    it('should validate provided token without changing status', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });
      
      const result = await auth.validateToken('other-token');

      expect(result).toBe(true);
      expect(auth.getToken()).toBeNull(); // status unchanged
    });

    it('should return false on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));
      auth.saveToken('test-token');

      const result = await auth.validateToken();

      expect(result).toBe(false);
    });
  });

  describe('getUserInfo', () => {
    it('should return null when no token', async () => {
      const info = await auth.getUserInfo();
      expect(info).toBeNull();
    });

    it('should return user info when API succeeds', async () => {
      auth.saveToken('valid-token');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
          plan: 'paid',
          expires_at: 1700000000000
        })
      });

      const info = await auth.getUserInfo();

      expect(info).toEqual({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        plan: 'paid',
        expiresAt: 1700000000000
      });
    });

    it('should return null when API fails', async () => {
      auth.saveToken('invalid-token');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

      const info = await auth.getUserInfo();

      expect(info).toBeNull();
    });
  });

  describe('getApiBase', () => {
    it('should return configured URL if provided', async () => {
      const auth2 = new AuthManager({ apiUrl: 'https://custom.api.com' });
      const url = await auth2.getApiBase();
      expect(url).toBe('https://custom.api.com');
    });

    it('should load domain from remote config', async () => {
      auth = new AuthManager();
      
      const url = await auth.getApiBase();
      
      expect(url).toBe('https://api.test.com');
    });
  });

  describe('status', () => {
    it('should be unauthenticated by default', () => {
      expect(auth.status).toBe('unauthenticated');
    });

    it('should be authenticated after saveToken', () => {
      auth.saveToken('test-token');
      expect(auth.status).toBe('authenticated');
    });

    it('should be unauthenticated after clearToken', () => {
      auth.saveToken('test-token');
      auth.clearToken();
      expect(auth.status).toBe('unauthenticated');
    });
  });

  describe('onStatusChange', () => {
    it('should call callback when status changes', () => {
      const callback = vi.fn();
      auth.onStatusChange(callback);

      auth.saveToken('test-token');

      expect(callback).toHaveBeenCalledWith('authenticated');
    });

    it('should not call callback when status unchanged', () => {
      const callback = vi.fn();
      auth.onStatusChange(callback);

      // saveToken twice with same result
      auth.saveToken('test-token');
      auth.saveToken('another-token');

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
