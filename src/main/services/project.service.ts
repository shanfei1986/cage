import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import type {
  ActionResult,
  AdvancePayload,
  PageResult,
  Project,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectStatus,
  ProjectUpdateInput
} from '@shared/types'
import { STATUS_LABEL, STATUS_TRANSITIONS } from '@shared/projectStatus'
import { checkTaskNoFormat } from '@shared/taskNo'
import { nowLocal, todayLocal } from '@shared/datetime'
import { getDb } from '../db/connection'
import * as repo from '../db/repositories/project.repo'
import { addLog } from '../db/repositories/log.repo'
import { getTaskPrefix } from '../db/repositories/setting.repo'

function operatorName(): string {
  try {
    return userInfo().username || '本机用户'
  } catch {
    return '本机用户'
  }
}

function clean(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** 当前状态下允许流转到的目标状态（唯一权威判断，界面置灰也用它） */
export function allowedTargets(project: Project): ProjectStatus[] {
  if (project.status === 'paused') {
    const back = project.paused_from_status ?? 'received'
    return [back, 'cancelled']
  }
  return STATUS_TRANSITIONS[project.status] ?? []
}

/** 任务单号可用性检查，给新建/编辑表单做实时校验用 */
export function checkTaskNo(
  raw: string,
  excludeId?: string
): ActionResult<{ value: string; prefixWarning?: string }> {
  const check = checkTaskNoFormat(raw, getTaskPrefix())
  if (!check.ok) return { ok: false, message: check.error }

  const dup = repo.findByTaskNo(check.value, excludeId)
  if (dup) {
    return {
      ok: false,
      message: `任务单号 ${check.value} 已被占用：${dup.name}（${STATUS_LABEL[dup.status]}）`
    }
  }
  return {
    ok: true,
    data: { value: check.value, prefixWarning: check.prefixWarning },
    warnings: check.prefixWarning ? [check.prefixWarning] : []
  }
}

export function listProjects(query: ProjectListQuery): PageResult<Project> {
  return repo.list(query)
}

export function getProject(id: string): Project | null {
  return repo.findById(id)
}

export function createProject(input: ProjectCreateInput): ActionResult<Project> {
  const name = clean(input.name)
  const clientName = clean(input.client_name)
  if (!name) return { ok: false, message: '请填写项目名称' }
  if (!clientName) return { ok: false, message: '请填写委托方名称' }

  const check = checkTaskNoFormat(input.task_no, getTaskPrefix())
  if (!check.ok) return { ok: false, message: check.error }
  const warnings: string[] = []
  if (check.prefixWarning) warnings.push(check.prefixWarning)

  const dup = repo.findByTaskNo(check.value)
  if (dup) {
    return {
      ok: false,
      message: `任务单号 ${check.value} 已被占用：${dup.name}（${STATUS_LABEL[dup.status]}）`
    }
  }

  const now = nowLocal()
  const row: Project = {
    id: randomUUID(),
    task_no: check.value,
    name,
    client_name: clientName,
    client_contact: clean(input.client_contact),
    client_phone: clean(input.client_phone),
    project_address: clean(input.project_address),
    project_type: clean(input.project_type),
    test_category: clean(input.test_category),
    building_count: input.building_count ?? null,
    building_area: input.building_area ?? null,
    floors: clean(input.floors),
    struct_type: clean(input.struct_type),
    source: clean(input.source),
    handler: clean(input.handler),
    testers: clean(input.testers),
    receive_date: clean(input.receive_date) ?? todayLocal(),
    expect_finish_date: clean(input.expect_finish_date),
    plan_test_date: null,
    actual_test_date: null,
    report_due_date: null,
    report_issue_date: null,
    status: 'received',
    test_status: 'none',
    test_round: 0,
    report_no: null,
    report_status: 'none',
    contact_note: null,
    test_remark: null,
    organize_note: null,
    cancel_reason: null,
    pause_reason: null,
    paused_from_status: null,
    remark: clean(input.remark),
    created_at: now,
    updated_at: now,
    closed_at: null
  }

  getDb().transaction(() => {
    repo.insert(row)
    addLog({
      projectId: row.id,
      action: 'create',
      toStatus: 'received',
      content: `新建项目「${row.name}」，任务单号 ${row.task_no}`,
      payload: { task_no: row.task_no, name: row.name, client_name: row.client_name },
      operator: operatorName()
    })
  })

  return { ok: true, data: row, warnings }
}

export function updateProject(id: string, patch: ProjectUpdateInput): ActionResult<Project> {
  const before = repo.findById(id)
  if (!before) return { ok: false, message: '项目不存在或已被删除' }

  const warnings: string[] = []
  const next: Record<string, unknown> = {}

  // 任务单号改动需要重新校验
  if (patch.task_no !== undefined) {
    const r = checkTaskNo(String(patch.task_no ?? ''), id)
    if (!r.ok || !r.data) return { ok: false, message: r.message }
    if (r.warnings?.length) warnings.push(...r.warnings)
    next.task_no = r.data.value
  }

  if (patch.name !== undefined) {
    const v = clean(patch.name)
    if (!v) return { ok: false, message: '请填写项目名称' }
    next.name = v
  }
  if (patch.client_name !== undefined) {
    const v = clean(patch.client_name)
    if (!v) return { ok: false, message: '请填写委托方名称' }
    next.client_name = v
  }

  const textFields: Array<keyof ProjectUpdateInput> = [
    'client_contact',
    'client_phone',
    'project_address',
    'project_type',
    'test_category',
    'floors',
    'struct_type',
    'source',
    'handler',
    'testers',
    'receive_date',
    'expect_finish_date',
    'remark',
    'report_no'
  ]
  for (const f of textFields) {
    if (patch[f] !== undefined) next[f] = clean(patch[f] as string | null | undefined)
  }

  const dateFields: Array<keyof ProjectUpdateInput> = [
    'plan_test_date',
    'actual_test_date',
    'report_due_date',
    'report_issue_date'
  ]
  for (const f of dateFields) {
    if (patch[f] !== undefined) next[f] = clean(patch[f] as string | null | undefined)
  }

  if (patch.building_count !== undefined) next.building_count = patch.building_count ?? null
  if (patch.building_area !== undefined) next.building_area = patch.building_area ?? null

  // 记录实际变了哪些字段，写进日志便于追溯
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, v] of Object.entries(next)) {
    const oldVal = (before as unknown as Record<string, unknown>)[k] ?? null
    const newVal = v ?? null
    if (String(oldVal ?? '') !== String(newVal ?? '')) diff[k] = { from: oldVal, to: newVal }
  }
  if (Object.keys(diff).length === 0) return { ok: true, data: before }

  getDb().transaction(() => {
    repo.updateFields(id, next)
    addLog({
      projectId: id,
      action: 'update',
      content: `修改项目信息：${Object.keys(diff).join('、')}`,
      payload: diff,
      operator: operatorName()
    })
  })

  const after = repo.findById(id)
  return { ok: true, data: after ?? before, warnings }
}

/** 各目标状态对应的处理逻辑。返回要写入的字段 + 给人看的一句话。 */
function buildTransition(
  before: Project,
  to: ProjectStatus,
  payload: AdvancePayload
): { patch: Record<string, unknown>; content: string } | { error: string } {
  const patch: Record<string, unknown> = { status: to }

  switch (to) {
    case 'contacted': {
      patch.contact_note = clean(payload.contact_note)
      return {
        patch,
        content: patch.contact_note
          ? `联系委托方：${patch.contact_note as string}`
          : '已联系委托方'
      }
    }

    case 'scheduled': {
      // 从 testing 回到 scheduled = 本次部分完成，需再次进场
      if (before.status === 'testing') {
        const remark = clean(payload.test_remark)
        if (!remark) return { error: '部分完成时必须填写待补充的检测内容' }
        patch.test_status = 'partial'
        patch.test_remark = remark
        patch.plan_test_date = clean(payload.plan_test_date)
        return {
          patch,
          content: `本次检测部分完成，待补充：${remark}`
        }
      }
      const date = clean(payload.plan_test_date)
      if (!date) return { error: '请填写与委托方约定的检测日期' }
      patch.plan_test_date = date
      // 约定进场日期时顺手记一条联系记录
      if (payload.contact_note !== undefined) patch.contact_note = clean(payload.contact_note)
      return { patch, content: `已确定检测日期：${date}` }
    }

    case 'testing': {
      const date = clean(payload.actual_test_date) ?? todayLocal()
      patch.actual_test_date = date
      patch.test_round = (before.test_round ?? 0) + 1
      return { patch, content: `进场检测（第 ${(before.test_round ?? 0) + 1} 次），日期 ${date}` }
    }

    case 'organizing': {
      patch.test_status = 'done'
      // 只在用户真的填了说明时才覆盖。留空不能把之前"部分完成"时
      // 记下的待补内容抹掉 —— 那条信息在时间轴里虽然也有，但详情页上
      // 直接看到更方便。
      const note = clean(payload.test_remark)
      if (note) patch.test_remark = note
      return { patch, content: '现场检测全部完成，转入整理记录' }
    }

    case 'reporting': {
      patch.organize_note = clean(payload.organize_note)
      patch.report_status = 'drafting'
      return {
        patch,
        content: patch.organize_note ? `开始出具报告：${patch.organize_note as string}` : '开始出具报告'
      }
    }

    case 'report_issued': {
      const no = clean(payload.report_no)
      if (!no) return { error: '请填写报告编号' }
      const date = clean(payload.report_issue_date) ?? todayLocal()
      patch.report_no = no
      patch.report_issue_date = date
      patch.report_status = 'issued'
      return { patch, content: `报告已出具：编号 ${no}，日期 ${date}` }
    }

    case 'closed': {
      patch.closed_at = nowLocal()
      return { patch, content: '项目已归档' }
    }

    case 'paused': {
      patch.pause_reason = clean(payload.pause_reason)
      patch.paused_from_status = before.status
      return {
        patch,
        content: patch.pause_reason ? `项目暂缓：${patch.pause_reason as string}` : '项目暂缓'
      }
    }

    case 'cancelled': {
      const reason = clean(payload.cancel_reason)
      if (!reason) return { error: '取消项目时必须填写原因' }
      patch.cancel_reason = reason
      return { patch, content: `项目已取消：${reason}` }
    }

    case 'received': {
      // 从暂缓恢复
      patch.paused_from_status = null
      patch.pause_reason = null
      return { patch, content: '项目恢复推进' }
    }

    default:
      return { error: `不支持流转到 ${to}` }
  }
}

export function changeStatus(
  id: string,
  to: ProjectStatus,
  payload: AdvancePayload = {}
): ActionResult<Project> {
  const before = repo.findById(id)
  if (!before) return { ok: false, message: '项目不存在或已被删除' }

  const allowed = allowedTargets(before)
  if (!allowed.includes(to)) {
    return {
      ok: false,
      message: `当前状态「${STATUS_LABEL[before.status]}」不能流转到「${STATUS_LABEL[to]}」`
    }
  }

  const built = buildTransition(before, to, payload)
  if ('error' in built) return { ok: false, message: built.error }

  // 详情页可能同时改了报告应出日期，一起带上
  if (payload.report_due_date !== undefined) {
    built.patch.report_due_date = clean(payload.report_due_date)
  }

  getDb().transaction(() => {
    repo.updateFields(id, built.patch)
    addLog({
      projectId: id,
      action: 'status',
      fromStatus: before.status,
      toStatus: to,
      content: built.content,
      payload: { patch: built.patch },
      operator: operatorName()
    })
  })

  const after = repo.findById(id)
  return { ok: true, data: after ?? before }
}

export function removeProject(id: string): ActionResult {
  const before = repo.findById(id)
  if (!before) return { ok: false, message: '项目不存在或已被删除' }
  getDb().transaction(() => {
    repo.remove(id)
  })
  return { ok: true }
}
