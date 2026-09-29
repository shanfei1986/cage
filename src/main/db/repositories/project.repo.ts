import type { PageResult, Project, ProjectListQuery, ProjectStatus } from '@shared/types'
import { getDb } from '../connection'

/** 允许排序的字段白名单 —— 防止排序参数被拼进 SQL 造成注入 */
const SORTABLE = new Set([
  'task_no',
  'name',
  'client_name',
  'status',
  'receive_date',
  'plan_test_date',
  'actual_test_date',
  'report_due_date',
  'report_issue_date',
  'created_at',
  'updated_at'
])

function orderClause(query: ProjectListQuery): string {
  const field = query.sortField && SORTABLE.has(query.sortField) ? query.sortField : 'updated_at'
  const dir = query.sortOrder === 'asc' ? 'ASC' : 'DESC'
  return `ORDER BY ${field} ${dir}, id DESC`
}

export function findById(id: string): Project | null {
  return getDb().get<Project>('SELECT * FROM project WHERE id = ?', id) ?? null
}

/** 按任务单号查找。传 excludeId 时排除自己，用于编辑场景的重复校验。 */
export function findByTaskNo(taskNo: string, excludeId?: string): Project | null {
  const sql = excludeId
    ? 'SELECT * FROM project WHERE task_no = ? AND id <> ? LIMIT 1'
    : 'SELECT * FROM project WHERE task_no = ? LIMIT 1'
  const params = excludeId ? [taskNo, excludeId] : [taskNo]
  return getDb().get<Project>(sql, ...params) ?? null
}

export function insert(row: Project): void {
  getDb().run(
    `INSERT INTO project (
       id, task_no, name, client_name, client_contact, client_phone, project_address,
       project_type, test_category, building_count, building_area, floors, struct_type,
       source, handler, testers,
       receive_date, expect_finish_date, plan_test_date, actual_test_date, report_due_date, report_issue_date,
       status, test_status, test_round, report_no, report_status,
       contact_note, test_remark, organize_note, cancel_reason, pause_reason, paused_from_status, remark,
       created_at, updated_at, closed_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id,
    row.task_no,
    row.name,
    row.client_name,
    row.client_contact,
    row.client_phone,
    row.project_address,
    row.project_type,
    row.test_category,
    row.building_count,
    row.building_area,
    row.floors,
    row.struct_type,
    row.source,
    row.handler,
    row.testers,
    row.receive_date,
    row.expect_finish_date,
    row.plan_test_date,
    row.actual_test_date,
    row.report_due_date,
    row.report_issue_date,
    row.status,
    row.test_status,
    row.test_round,
    row.report_no,
    row.report_status,
    row.contact_note,
    row.test_remark,
    row.organize_note,
    row.cancel_reason,
    row.pause_reason,
    row.paused_from_status,
    row.remark,
    row.created_at,
    row.updated_at,
    row.closed_at
  )
}

/** 只列在更新白名单里的字段可被修改，避免界面传进 id / created_at 之类的字段被覆盖 */
const UPDATABLE = new Set([
  'task_no',
  'name',
  'client_name',
  'client_contact',
  'client_phone',
  'project_address',
  'project_type',
  'test_category',
  'building_count',
  'building_area',
  'floors',
  'struct_type',
  'source',
  'handler',
  'testers',
  'receive_date',
  'expect_finish_date',
  'plan_test_date',
  'actual_test_date',
  'report_due_date',
  'report_issue_date',
  'status',
  'test_status',
  'test_round',
  'report_no',
  'report_status',
  'contact_note',
  'test_remark',
  'organize_note',
  'cancel_reason',
  'pause_reason',
  'paused_from_status',
  'remark',
  'closed_at'
])

/** 按字段名局部更新。调用方负责先做业务校验。 */
export function updateFields(id: string, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k))
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const params = keys.map((k) => {
    const v = patch[k]
    if (v === undefined || v === null) return null
    if (typeof v === 'boolean') return v ? 1 : 0
    return v as string | number
  })
  getDb().run(
    `UPDATE project SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`,
    ...params,
    id
  )
}

export function remove(id: string): void {
  // project_log 上有 ON DELETE CASCADE，日志会跟着一起删
  getDb().run('DELETE FROM project WHERE id = ?', id)
}

/**
 * 列表查询：关键字 + 状态筛选 + 分页。
 *
 * restrictIds 用于"只看待办"这类由业务层算出来的 id 集合（SQL 里没法直接表达那些
 * 判定规则）。传 null 表示不限制；传空数组表示"一条都不匹配"，必须直接返回空页 ——
 * 否则会拼出 `IN ()` 这种非法 SQL。
 */
export function list(query: ProjectListQuery, restrictIds?: string[] | null): PageResult<Project> {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))

  if (restrictIds && restrictIds.length === 0) {
    return { rows: [], total: 0, page, pageSize }
  }

  const where: string[] = []
  const params: Array<string | number> = []

  if (restrictIds && restrictIds.length > 0) {
    where.push(`id IN (${restrictIds.map(() => '?').join(',')})`)
    params.push(...restrictIds)
  }
  if (query.status && query.status !== 'all') {
    where.push('status = ?')
    params.push(query.status)
  }
  if (query.client_name) {
    where.push('client_name = ?')
    params.push(query.client_name)
  }
  const kw = (query.keyword ?? '').trim()
  if (kw) {
    where.push(
      '(task_no LIKE ? OR name LIKE ? OR client_name LIKE ? OR project_address LIKE ? OR handler LIKE ?)'
    )
    const like = `%${kw}%`
    params.push(like, like, like, like, like)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total =
    getDb().get<{ c: number }>(`SELECT COUNT(*) AS c FROM project ${whereSql}`, ...params)?.c ?? 0

  const rows = getDb().all<Project>(
    `SELECT * FROM project ${whereSql} ${orderClause(query)} LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize
  )

  return { rows, total, page, pageSize }
}

/**
 * 取全部匹配行（不分页），供导出 Excel 用。
 * 加个上限防止极端情况下把内存撑爆 —— 真要导几万行，那是另一个量级的问题。
 */
export function listAll(query: ProjectListQuery, restrictIds?: string[] | null): Project[] {
  const pageSize = 200
  const first = list({ ...query, page: 1, pageSize }, restrictIds)
  if (first.total <= first.rows.length) return first.rows

  const out: Project[] = [...first.rows]
  const pages = Math.ceil(first.total / pageSize)
  for (let p = 2; p <= pages; p++) {
    out.push(...list({ ...query, page: p, pageSize }, restrictIds).rows)
  }
  return out
}

/** 各状态项目数量，仪表盘与列表页签用 */
export function countByStatus(): Record<string, number> {
  const rows = getDb().all<{ status: ProjectStatus; c: number }>(
    'SELECT status, COUNT(*) AS c FROM project GROUP BY status'
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.status] = r.c
  return out
}

export function countAll(): number {
  return getDb().get<{ c: number }>('SELECT COUNT(*) AS c FROM project')?.c ?? 0
}

/** 委托方名称列表，用于筛选下拉 */
export function listClients(): string[] {
  // 注意：SQLite 里空字符串必须用单引号。写成 "" 会被当成标识符并报
  // "no such column"（这个坑是截图脚本跑出来的）
  const rows = getDb().all<{ client_name: string }>(
    "SELECT DISTINCT client_name FROM project WHERE client_name IS NOT NULL AND client_name <> '' ORDER BY client_name"
  )
  return rows.map((r) => r.client_name)
}
