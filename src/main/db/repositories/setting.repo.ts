import { getDb } from '../connection'

/** 读取一个设置项；不存在返回 null */
export function getSetting(key: string): string | null {
  const row = getDb().get<{ value: string | null }>('SELECT value FROM setting WHERE key = ?', key)
  return row?.value ?? null
}

/** 读取一个数值型设置项，缺失或非法时用 fallback */
export function getNumberSetting(key: string, fallback: number): number {
  const raw = getSetting(key)
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** 写入设置项 */
export function setSetting(key: string, value: string): void {
  getDb().run(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value
  )
}

/** 一次性读取全部设置，界面初始化时用 */
export function getAllSettings(): Record<string, string> {
  const rows = getDb().all<{ key: string; value: string | null }>('SELECT key, value FROM setting')
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value ?? ''
  return out
}

/** 全院统一的任务单号前缀 */
export function getTaskPrefix(): string {
  const v = getSetting('org.task_prefix')
  return v && v.trim() ? v.trim().toLowerCase() : 'lz'
}
