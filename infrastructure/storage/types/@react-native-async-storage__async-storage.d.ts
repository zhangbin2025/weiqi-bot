/**
 * Type declarations for @react-native-async-storage/async-storage
 * @description Minimal type definitions for AsyncStorage in non-RN environments
 */

declare module '@react-native-async-storage/async-storage' {
  export interface AsyncStorageStatic {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    getAllKeys(): Promise<readonly string[]>;
    multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
    multiSet(keyValuePairs: readonly (readonly [string, string])[]): Promise<void>;
    multiRemove(keys: readonly string[]): Promise<void>;
  }

  const AsyncStorage: AsyncStorageStatic;
  export default AsyncStorage;
}
