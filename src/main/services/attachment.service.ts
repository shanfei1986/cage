import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { ActionResult, Attachment } from '@shared/types'
import { extFromFileName, isImageExt, mimeFromExt } from '@shared/attachment'
import { nowLocal } from '@shared/datetime'
import { getDb } from '../db/connection'
import * as repo from '../db/repositories/attachment.repo'
import { findById as findProjectById } from '../db/repositories/project.repo'
import { addLog } from '../db/repositories/log.repo'

/**
 * 现场照片的落盘与登记。
 *
 * 分工：磁盘文件名一律用 UUID，原文件名单独存在库里只为界面显示 —— 原文件名可能
 * 重名、含中文/emoji、甚至带路径分隔符，直接拿来当磁盘名是自找麻烦。
 */

let attachmentsRoot = ''

/** 在 app.whenReady() 内调用一次 */
export function initAttachmentsDir(root: string): void {
  mkdirSync(root, { recursive: true })
  attachmentsRoot = root
}

export function getAttachmentsDir(): string {
  if (!attachmentsRoot) throw new Error('附件目录尚未初始化')
  return attachmentsRoot
}

export function list(projectId: string): Attachment[] {
  return repo.listByProject(projectId)
}

export function countOf(projectId: string): number {
  return repo.countByProject(projectId)
}

/**
 * 把用户选中的文件复制进附件目录并登记。
 *
 * 只接受图片类型：多选对话框里挂了"所有文件"选项，用户可能误选一个 .docx，
 * 那种情况下不静默吞掉，而是在返回值里明确说跳过了哪些。
 */
export function addByPaths(projectId: string, paths: string[]): ActionResult<Attachment[]> {
  if (!findProjectById(projectId)) return { ok: false, message: '项目不存在' }
  if (!paths || paths.length === 0) return { ok: true, data: [], message: '没有选择文件' }

  const root = getAttachmentsDir()
  const projectDir = join(root, projectId)
  mkdirSync(projectDir, { recursive: true })

  const created: Attachment[] = []
  const skipped: string[] = []

  for (const src of paths) {
    try {
      const name = basename(src)
      const ext = extFromFileName(name)
      if (!isImageExt(ext)) {
        skipped.push(name)
        continue
      }
      if (!existsSync(src)) {
        skipped.push(name)
        continue
      }

      const id = randomUUID()
      const storedName = `${id}.${ext}`
      const dest = join(projectDir, storedName)
      copyFileSync(src, dest)

      const row: Attachment = {
        id,
        project_id: projectId,
        file_name: name,
        stored_name: storedName,
        rel_path: `${projectId}/${storedName}`,
        ext,
        mime_type: mimeFromExt(ext),
        size_bytes: statSync(dest).size,
        width: null,
        height: null,
        taken_at: null,
        sort: repo.nextSort(projectId),
        created_at: nowLocal()
      }
      repo.insert(row)
      created.push(row)
    } catch {
      skipped.push(basename(src))
    }
  }

  if (created.length > 0) {
    addLog({
      projectId,
      action: 'attachment',
      content: `添加了 ${created.length} 张现场照片`,
      payload: { added: created.map((a) => a.file_name) }
    })
  }

  const parts: string[] = []
  if (created.length > 0) parts.push(`已添加 ${created.length} 张照片`)
  if (skipped.length > 0) {
    parts.push(`${skipped.length} 个文件被跳过（不是图片格式）：${skipped.join('、')}`)
  }

  return {
    ok: true,
    data: created,
    message: parts.join('；') || '没有可添加的文件'
  }
}

export function remove(attachmentId: string): ActionResult {
  const row = repo.findById(attachmentId)
  if (!row) return { ok: false, message: '这张照片不存在（可能已被删除）' }

  // 先删库再删文件：万一删文件失败，最多留个孤儿文件（浪费点空间），
  // 反过来则会出现"记录还在、图打不开"的破图状态，更难处理
  repo.removeById(attachmentId)
  try {
    rmSync(join(getAttachmentsDir(), row.rel_path), { force: true })
  } catch {
    /* 文件已经不在了也无所谓 */
  }

  addLog({
    projectId: row.project_id,
    action: 'attachment',
    content: `删除了一张现场照片：${row.file_name}`
  })

  return { ok: true }
}

/**
 * 删项目时清理它的照片目录。
 * 必须在删项目的事务提交之后调用 —— 事务里动文件的话，回滚时文件已经没了。
 * 删文件失败只当没发生，不要把已经成功的业务操作弄成"失败"。
 */
export function removeProjectFiles(projectId: string): void {
  if (!attachmentsRoot) return
  try {
    rmSync(join(attachmentsRoot, projectId), { recursive: true, force: true })
  } catch (err) {
    console.warn(`[attachment] 清理项目照片目录失败：${projectId}`, err)
  }
}

/** 附件表总条数，备份/排查时用来核对 */
export function countAll(): number {
  return repo.countAll()
}

/** 统计每个项目的照片数，供列表页显示 */
export function countsByProject(): Record<string, number> {
  const rows = getDb().all<{ project_id: string; c: number }>(
    'SELECT project_id, COUNT(*) AS c FROM attachment GROUP BY project_id'
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.project_id] = Number(r.c)
  return out
}

/** 仅用于自检/测试：把字符串扩展名规范化一下，避免调用方各自实现 */
export function normalizeExt(pathLike: string): string {
  return extname(pathLike).replace(/^\./, '').toLowerCase()
}
