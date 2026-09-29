import type { ProjectStatus, ReportStatus, TestStatus } from './types'

/** 状态中文名（界面统一从这里取，不散落在各页面） */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  received: '已接单',
  contacted: '已联系委托方',
  scheduled: '已定检测日期',
  testing: '检测中',
  organizing: '整理记录中',
  reporting: '出具报告中',
  report_issued: '报告已出',
  closed: '已归档',
  paused: '已暂缓',
  cancelled: '已取消'
}

/** 状态对应的 AntD Tag 颜色 */
export const STATUS_COLOR: Record<ProjectStatus, string> = {
  received: 'default',
  contacted: 'blue',
  scheduled: 'cyan',
  testing: 'processing',
  organizing: 'geekblue',
  reporting: 'orange',
  report_issued: 'green',
  closed: 'default',
  paused: 'warning',
  cancelled: 'error'
}

export const TEST_STATUS_LABEL: Record<TestStatus, string> = {
  none: '未开始',
  partial: '部分完成',
  done: '已完成'
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  none: '未开始',
  drafting: '编写中',
  issued: '已出具',
  sent: '已交付'
}

/**
 * 主流程的线性顺序（用于界面上的"流程进度条"）。
 * paused / cancelled 是旁支状态，不在主线里。
 */
export const MAIN_FLOW: ProjectStatus[] = [
  'received',
  'contacted',
  'scheduled',
  'testing',
  'organizing',
  'reporting',
  'report_issued',
  'closed'
]

/** 终态：不能再推进 */
export const TERMINAL_STATUS: ProjectStatus[] = ['closed', 'cancelled']

/**
 * 状态流转规则表（唯一权威定义）。
 * 主进程做校验时必须用它，渲染层只用来决定按钮是否置灰。
 */
export const STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  received: ['contacted', 'paused', 'cancelled'],
  contacted: ['scheduled', 'paused', 'cancelled'],
  // 注意：已定检测日期只能进"检测中"，不能直接跳到"整理记录中"——
  // 必须真的进场检测过。这一条是自检脚本发现的，别再加回 organizing。
  scheduled: ['testing', 'paused', 'cancelled'],
  // testing 允许回到 scheduled：用于"部分完成、需再次进场"
  testing: ['scheduled', 'organizing', 'paused', 'cancelled'],
  organizing: ['reporting', 'paused', 'cancelled'],
  reporting: ['report_issued', 'paused', 'cancelled'],
  report_issued: ['closed', 'paused'],
  closed: ['report_issued'],
  paused: [],
  cancelled: []
}

/** 判断某个状态流转是否合法 */
export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true
  return (STATUS_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * 计算"推进到下一阶段"的目标状态。
 * 返回 null 表示当前状态没有主线上的下一步（如终态、暂缓）。
 */
export function nextMainStatus(current: ProjectStatus): ProjectStatus | null {
  const idx = MAIN_FLOW.indexOf(current)
  if (idx < 0 || idx >= MAIN_FLOW.length - 1) return null
  return MAIN_FLOW[idx + 1]
}

/** 每个阶段推进时要填/要提示的说明文案，用于"推进到下一阶段"弹窗的引导 */
export const STAGE_PROMPT: Partial<Record<ProjectStatus, string>> = {
  contacted: '记录本次联系委托方的情况（联系人、沟通结果）。',
  scheduled: '填写与委托方约定的检测日期。',
  testing: '填写实际进场日期。',
  organizing: '检测完成后，说明本次检测是否全部完成；若只是部分完成，请写明待补事项。',
  reporting: '整理完记录，开始编制报告。',
  report_issued: '登记报告编号与实际出具日期。',
  closed: '确认项目收尾，归档。'
}
