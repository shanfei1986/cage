import type { SqliteDriver } from './driver'
import { SCHEMA_V1, SEED_V1_DICT, SEED_V1_SETTINGS } from './schema'

/**
 * 迁移：以 SQLite 自带的 user_version 作为版本号驱动。
 * 以后加字段就追加一个 if (current < N) 分支，绝不去改历史分支。
 */
export function runMigrations(db: SqliteDriver): { from: number; to: number } {
  const row = db.get<{ user_version: number }>('PRAGMA user_version')
  const current = Number(row?.user_version ?? 0)
  let version = current

  if (version < 1) {
    db.transaction(() => {
      db.exec(SCHEMA_V1)
      const insertSetting = SEED_V1_SETTINGS.map(() => '(?,?)').join(',')
      // 用 INSERT OR IGNORE，保证重复执行也不会覆盖用户改过的值
      db.run(
        `INSERT OR IGNORE INTO setting (key, value) VALUES ${insertSetting}`,
        ...SEED_V1_SETTINGS.flat()
      )

      const insertDict = SEED_V1_DICT.map(() => '(?,?,?,?)').join(',')
      db.run(
        `INSERT OR IGNORE INTO dict (type, code, label, sort) VALUES ${insertDict}`,
        ...SEED_V1_DICT.flat()
      )
    })
    version = 1
    db.exec(`PRAGMA user_version = ${version}`)
  }

  return { from: current, to: version }
}
