/**
 * 主进程与渲染进程共用的类型定义。
 * 放在 src/shared 下，两端都通过别名 @shared 引用，保证字段定义只有一份。
 */

/** 项目阶段状态 */
export type ProjectStatus =
  | 'received' // 已接单
  | 'contacted' // 已联系委托方
  | 'scheduled' // 已确定检测日期
  | 'testing' // 检测中
  | 'organizing' // 整理记录中
  | 'reporting' // 出具报告中
  | 'report_issued' // 报告已出具
  | 'closed' // 已归档（终态）
  | 'paused' // 已暂缓
  | 'cancelled' // 已取消（终态）

/** 检测完成情况 */
export type TestStatus = 'none' | 'partial' | 'done'

/** 报告状态 */
export type ReportStatus = 'none' | 'drafting' | 'issued' | 'sent'

/**
 * 待办紧急程度。
 * - overdue 已超期（含"约定检测日期已过"）
 * - today   恰好今天到期（正好到阈值的第 N 天，或事件日期就是今天）
 * - soon    还没到，但已进入提醒窗口
 */
export type AlertLevel = 'overdue' | 'today' | 'soon'

/** 项目主表记录 */
export interface Project {
  id: string
  task_no: string

  // 任务信息
  name: string
  client_name: string
  client_contact: string | null
  client_phone: string | null
  project_address: string | null
  project_type: string | null
  test_category: string | null
  building_count: number | null
  building_area: number | null
  floors: string | null
  struct_type: string | null

  // 人员
  source: string | null
  handler: string | null
  testers: string | null

  // 时间节点
  receive_date: string | null
  expect_finish_date: string | null
  plan_test_date: string | null
  actual_test_date: string | null
  report_due_date: string | null
  report_issue_date: string | null

  // 阶段状态
  status: ProjectStatus
  test_status: TestStatus
  test_round: number
  report_no: string | null
  report_status: ReportStatus

  // 备注与其他
  contact_note: string | null
  test_remark: string | null
  organize_note: string | null
  cancel_reason: string | null
  pause_reason: string | null
  paused_from_status: ProjectStatus | null
  remark: string | null

  created_at: string
  updated_at: string
  closed_at: string | null
}

/** 新建项目时的入参 */
export interface ProjectCreateInput {
  task_no: string
  name: string
  client_name: string
  client_contact?: string | null
  client_phone?: string | null
  project_address?: string | null
  project_type?: string | null
  test_category?: string | null
  building_count?: number | null
  building_area?: number | null
  floors?: string | null
  struct_type?: string | null
  source?: string | null
  handler?: string | null
  testers?: string | null
  receive_date?: string | null
  expect_finish_date?: string | null
  remark?: string | null
}

/** 修改项目时的入参（部分字段） */
export type ProjectUpdateInput = Partial<Omit<ProjectCreateInput, 'task_no'>> & {
  task_no?: string
  plan_test_date?: string | null
  actual_test_date?: string | null
  report_due_date?: string | null
  report_issue_date?: string | null
  report_no?: string | null
}

/** 项目列表查询条件 */
export interface ProjectListQuery {
  keyword?: string
  status?: ProjectStatus | 'all'
  client_name?: string
  /**
   * 只看待办。必须是服务端筛选：列表是分页的，如果在前端过滤当前页，
   * 一页 20 条筛完可能一条不剩，用户会以为数据丢了。
   */
  todo?: AlertLevel | 'all'
  page?: number
  pageSize?: number
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

/** 分页结果 */
export interface PageResult<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

/** 操作日志（时间轴） */
export interface ProjectLog {
  id: number
  project_id: string
  action: string
  from_status: ProjectStatus | null
  to_status: ProjectStatus | null
  content: string | null
  payload: string | null
  operator: string | null
  occurred_at: string
  created_at: string
}

/** 字典项 */
export interface DictItem {
  id: number
  type: string
  code: string
  label: string
  sort: number
  enabled: number
}

/**
 * 推进一步时要带的补充信息。
 * 不同目标状态只用到其中几个字段，主进程按目标状态挑着取，多余字段忽略。
 */
export interface AdvancePayload {
  /** → contacted：本次联系情况 */
  contact_note?: string | null
  /** → scheduled：约定/重新约定的检测日期 */
  plan_test_date?: string | null
  /** → testing：实际进场日期 */
  actual_test_date?: string | null
  /** → organizing（全部完成）/ → scheduled（部分完成） */
  test_status?: TestStatus
  /** 部分完成时必填：待补事项 */
  test_remark?: string | null
  /** → reporting：整理记录说明 */
  organize_note?: string | null
  /** → report_issued：报告编号 */
  report_no?: string | null
  report_issue_date?: string | null
  /** 可随时设置的报告应出日期（超期预警基准） */
  report_due_date?: string | null
  /** → paused */
  pause_reason?: string | null
  /** → cancelled */
  cancel_reason?: string | null
}

/** 统一的操作返回结果：失败时用 message 携带给人看的原因 */
export interface ActionResult<T = undefined> {
  ok: boolean
  message?: string
  data?: T
  /** 软提醒：不拦截保存，但要在界面上提示用户 */
  warnings?: string[]
}

/** 现场照片 / 附件（文件本身在磁盘上，这里只有元数据） */
export interface Attachment {
  id: string
  project_id: string
  /** 用户原始文件名，仅用于界面显示 */
  file_name: string
  /** 磁盘文件名：<uuid>.<ext> */
  stored_name: string
  /** 相对 attachments 根目录：<project_id>/<uuid>.<ext> */
  rel_path: string
  ext: string
  mime_type: string | null
  size_bytes: number
  width: number | null
  height: number | null
  taken_at: string | null
  sort: number
  created_at: string
}

/** 新增附件时的入参（主进程负责生成 id / stored_name / rel_path） */
export interface AttachmentCreateInput {
  project_id: string
  file_name: string
  ext: string
  mime_type: string | null
  size_bytes: number
}

/** 待办候选行：只取评估预警需要的字段，避免把整张 project 表读进来 */
export interface AlertCandidate {
  id: string
  task_no: string
  name: string
  status: ProjectStatus
  test_status: TestStatus
  receive_date: string | null
  plan_test_date: string | null
  report_due_date: string | null
  report_issue_date: string | null
  updated_at: string
}

/** 待办数量汇总 */
export interface AlertCounts {
  overdue: number
  today: number
  soon: number
  total: number
}

/** 统计报表数据（一次查询把 4 个维度全返回，界面上切换时间范围时整体重取） */
export interface StatsOverview {
  range: { months: number; since: string }
  /**
   * 按月项目量：接单量（按接单日期）+ 报告出具量（按实际出具日期）。
   * 第二个系列用"报告出具"而不是"归档"：归档只是内部记账动作，很多同事根本
   * 不会去点；而且实际出具日期是可以补录的，历史项目导进来也能画出真实曲线。
   * 缺失月份由前端补 0（见 shared/stats.ts 的 mergeTrend）。
   */
  trend: Array<{ ym: string; received: number; issued: number }>
  byProjectType: Array<{ code: string | null; label: string; count: number }>
  byStatus: Array<{ status: ProjectStatus; count: number }>
  cycle: {
    /** 接单 → 实际进场 平均天数 */
    avgReceiveToTest: number | null
    /** 接单 → 报告出具 平均天数 */
    avgReceiveToReport: number | null
    /** 已出具报告中，实际出具日超过应出日期的份数 */
    reportOverdueIssued: number
    /** 填过应出日期、且已出具的报告份数（超期率的分母） */
    reportIssuedWithDue: number
    /** 报告超期率（0-1），无样本时为 null */
    reportOverdueRate: number | null
    /** 当前在办项目里，报告应出日期已过的数量 */
    reportOverdueOpen: number
  }
}

/** 备份状态 */
export interface BackupInfo {
  lastBackupAt: string
  lastRestoreAt: string
  /** 备份文件里会包含的内容说明，直接展示给用户看 */
  includes: string[]
}
