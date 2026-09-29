import { DatabaseSync, type StatementSync } from 'node:sqlite'

/**
 * SQLite 驱动抽象层。
 *
 * 为什么要有这一层：项目确定用 Node 内置的 node:sqlite 作为首选（零原生依赖、
 * 不需要 @electron/rebuild、跨平台打包风险最低）。但万一某个 Electron 版本
 * 没有暴露 node:sqlite，只需在 connection.ts 里换一个工厂实现即可切到
 * better-sqlite3 —— 两者 API 几乎同形（prepare / all / get / run）。
 * 仓储层只依赖下面这个接口，不依赖任何具体库。
 */

export type SqlParam = string | number | bigint | null | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface SqliteDriver {
  /** 执行一段可能包含多条语句的 SQL，不关心返回结果 */
  exec(sql: string): void
  /** 查询多行 */
  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[]
  /** 查询单行 */
  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined
  /** 执行写入语句 */
  run(sql: string, ...params: SqlParam[]): RunResult
  /** 事务包装：回调抛异常则整体回滚。支持嵌套（内层用 SAVEPOINT） */
  transaction<T>(fn: () => T): T
  close(): void
}

/** 预编译语句缓存上限，防止动态 SQL 把内存撑爆 */
const STMT_CACHE_LIMIT = 200

export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync
  private readonly stmts = new Map<string, StatementSync>()
  private depth = 0

  constructor(file: string) {
    this.db = new DatabaseSync(file)
  }

  private stmt(sql: string): StatementSync {
    const cached = this.stmts.get(sql)
    if (cached) return cached
    const prepared = this.db.prepare(sql)
    if (this.stmts.size >= STMT_CACHE_LIMIT) this.stmts.clear()
    this.stmts.set(sql, prepared)
    return prepared
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined {
    return (this.stmt(sql).get(...params) as T | undefined) ?? undefined
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const r = this.stmt(sql).run(...params)
    return {
      changes: Number(r.changes ?? 0),
      lastInsertRowid:
        typeof r.lastInsertRowid === 'bigint' ? r.lastInsertRowid : Number(r.lastInsertRowid ?? 0)
    }
  }

  transaction<T>(fn: () => T): T {
    const nested = this.depth > 0
    const name = `sp_${this.depth}`

    if (nested) this.exec(`SAVEPOINT ${name}`)
    else this.exec('BEGIN')
    this.depth++

    try {
      const result = fn()
      this.depth--
      if (nested) this.exec(`RELEASE ${name}`)
      else this.exec('COMMIT')
      return result
    } catch (err) {
      this.depth--
      try {
        if (nested) {
          this.exec(`ROLLBACK TO ${name}`)
          this.exec(`RELEASE ${name}`)
        } else {
          this.exec('ROLLBACK')
        }
      } catch {
        /* 回滚失败时保留原始异常，不要把真实原因盖掉 */
      }
      throw err
    }
  }

  close(): void {
    this.stmts.clear()
    this.db.close()
  }
}

/**
 * 当前是否可以使用 Node 内置的 node:sqlite。
 * 用于启动前自检，失败时给出明确提示而不是抛一个看不懂的错误。
 */
export function isNodeSqliteAvailable(): boolean {
  try {
    const probe = new DatabaseSync(':memory:')
    probe.exec('CREATE TABLE _probe (a INTEGER)')
    probe.close()
    return true
  } catch {
    return false
  }
}
