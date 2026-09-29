import type { Attachment } from '@shared/types'
import { getDb } from '../connection'

/**
 * 附件（现场照片）仓储。
 *
 * 这一层只碰数据库，不碰文件系统 —— 复制/删除磁盘文件由
 * services/attachment.service.ts 负责。分开的好处是：自检脚本能在不落盘的情况下
 * 验证表结构、级联删除与查询逻辑。
 */

const COLUMNS = `id, project_id, file_name, stored_name, rel_path, ext,
                 mime_type, size_bytes, width, height, taken_at, sort, created_at`

export function insert(row: Attachment): void {
  getDb().run(
    `INSERT INTO attachment (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.project_id,
    row.file_name,
    row.stored_name,
    row.rel_path,
    row.ext,
    row.mime_type,
    row.size_bytes,
    row.width,
    row.height,
    row.taken_at,
    row.sort,
    row.created_at
  )
}

/** 按项目取全部附件。同一项目的照片按 sort、再按创建时间排，保证顺序稳定。 */
export function listByProject(projectId: string): Attachment[] {
  return getDb().all<Attachment>(
    `SELECT ${COLUMNS} FROM attachment
      WHERE project_id = ?
      ORDER BY sort ASC, created_at ASC, id ASC`,
    projectId
  )
}

export function findById(id: string): Attachment | null {
  return getDb().get<Attachment>(`SELECT ${COLUMNS} FROM attachment WHERE id = ?`, id) ?? null
}

/** 协议层反查用：由相对路径找回记录，确认这个文件确实登记在册 */
export function findByRelPath(relPath: string): Attachment | null {
  return (
    getDb().get<Attachment>(`SELECT ${COLUMNS} FROM attachment WHERE rel_path = ?`, relPath) ?? null
  )
}

/** 下一个排序号：取当前最大值 +10，留出插入空隙 */
export function nextSort(projectId: string): number {
  const row = getDb().get<{ max_sort: number | null }>(
    'SELECT MAX(sort) AS max_sort FROM attachment WHERE project_id = ?',
    projectId
  )
  return (row?.max_sort ?? 0) + 10
}

export function removeById(id: string): void {
  getDb().run('DELETE FROM attachment WHERE id = ?', id)
}

export function removeByProject(projectId: string): void {
  getDb().run('DELETE FROM attachment WHERE project_id = ?', projectId)
}

export function countAll(): number {
  const row = getDb().get<{ c: number }>('SELECT COUNT(*) AS c FROM attachment')
  return Number(row?.c ?? 0)
}

/** 每个项目的附件数量，列表页/详情页显示"现场照片（8）"用 */
export function countByProject(projectId: string): number {
  const row = getDb().get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM attachment WHERE project_id = ?',
    projectId
  )
  return Number(row?.c ?? 0)
}
