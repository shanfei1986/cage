import type { ProjectLog } from '@shared/types'
import { getDb } from '../connection'

export interface AddLogInput {
  projectId: string
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  /** 人类可读的一句话，例如"电话联系张工，约定 3/15 进场" */
  content?: string | null
  /** 本次变更的字段明细，会序列化成 JSON 存起来，便于追溯"到底改了什么" */
  payload?: unknown
  operator?: string | null
}

/** 写一条操作日志。所有状态流转与字段修改都必须经过它。 */
export function addLog(input: AddLogInput): void {
  getDb().run(
    `INSERT INTO project_log (project_id, action, from_status, to_status, content, payload, operator, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
    input.projectId,
    input.action,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.content ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    input.operator ?? null
  )
}

export function listLogs(projectId: string, limit = 300): ProjectLog[] {
  return getDb().all<ProjectLog>(
    'SELECT * FROM project_log WHERE project_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?',
    projectId,
    limit
  )
}

/** 全局最近动态，仪表盘用 */
export function listRecentLogs(limit = 20): Array<ProjectLog & { project_name?: string }> {
  return getDb().all<ProjectLog & { project_name?: string }>(
    `SELECT l.*, p.name AS project_name
       FROM project_log l
       LEFT JOIN project p ON p.id = l.project_id
      ORDER BY l.occurred_at DESC, l.id DESC
      LIMIT ?`,
    limit
  )
}

export function deleteLogsByProject(projectId: string): void {
  getDb().run('DELETE FROM project_log WHERE project_id = ?', projectId)
}
