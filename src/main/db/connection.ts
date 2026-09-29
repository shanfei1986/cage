import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { NodeSqliteDriver, isNodeSqliteAvailable, type SqliteDriver } from './driver'
import { runMigrations } from './migrate'

let driver: SqliteDriver | null = null
let dbFilePath = ''

export interface DbInitResult {
  file: string
  migration: { from: number; to: number }
}

/**
 * 初始化数据库。dataDir 由主进程传入：
 *   打包后 = app.getPath('userData')/data
 *   开发时 = app.getPath('userData')-dev/data，避免开发调试污染真实数据
 *
 * 注意：数据文件绝不放 exe 同目录或 Program Files —— 那里没有写权限。
 */
export function initDatabase(dataDir: string): DbInitResult {
  if (!isNodeSqliteAvailable()) {
    throw new Error(
      '当前运行环境不支持 Node 内置的 node:sqlite 模块，无法初始化数据库。请反馈此问题。'
    )
  }

  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, 'fwjc.db')

  const db = new NodeSqliteDriver(file)

  // WAL 让读写不互相阻塞，本地单机场景下更稳。注意它会产生 -wal / -shm 兄弟文件，
  // 备份时必须一起拷贝，否则换机会丢最新数据。
  db.get<{ journal_mode: string }>('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')

  const migration = runMigrations(db)

  driver = db
  dbFilePath = file

  return { file, migration }
}

export function getDb(): SqliteDriver {
  if (!driver) throw new Error('数据库尚未初始化')
  return driver
}

export function getDbPath(): string {
  return dbFilePath
}

/** 关闭前做一次 WAL checkpoint，把 -wal 里的内容并回主库，让 .db 单文件即完整 */
export function closeDatabase(): void {
  if (!driver) return
  try {
    driver.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    /* checkpoint 失败不阻塞退出 */
  }
  try {
    driver.close()
  } catch {
    /* 同上 */
  }
  driver = null
  dbFilePath = ''
}
