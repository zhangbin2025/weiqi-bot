/**
 * 调度管理器
 * 
 * 对等 Android ScheduleManager
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class ScheduleManager {
  private file: string;
  private schedules: Map<string, any> = new Map();

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.file = path.join(dataDir, 'schedules.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const content = fs.readFileSync(this.file, 'utf-8');
        const obj = JSON.parse(content);
        for (const key in obj) {
          this.schedules.set(key, obj[key]);
        }
        console.log(`[ScheduleManager] Loaded ${this.schedules.size} schedules`);
      }
    } catch (error) {
      console.error('[ScheduleManager] Failed to load:', error);
    }
  }

  private save() {
    try {
      const obj: any = {};
      this.schedules.forEach((value, key) => {
        obj[key] = value;
      });
      fs.writeFileSync(this.file, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[ScheduleManager] Failed to save:', error);
    }
  }

  add(config: any): string {
    return this.addSync(config);
  }

  addSync(config: any): string {
    const id = config.id || `schedule_${Date.now()}`;
    config.id = id;
    this.schedules.set(id, config);
    this.save();
    console.log(`[ScheduleManager] Added schedule: ${id}`);
    return id;
  }

  update(id: string, config: any): void {
    this.updateSync(id, config);
  }

  updateSync(id: string, config: any): void {
    config.id = id;
    this.schedules.set(id, config);
    this.save();
    console.log(`[ScheduleManager] Updated schedule: ${id}`);
  }

  delete(id: string): void {
    this.deleteSync(id);
  }

  deleteSync(id: string): void {
    this.schedules.delete(id);
    this.save();
    console.log(`[ScheduleManager] Deleted schedule: ${id}`);
  }

  get(id: string): any | null {
    return this.schedules.get(id) || null;
  }

  list(): any[] {
    return Array.from(this.schedules.values());
  }
}
