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
