import type {
  ActionResult,
  AdvancePayload,
  AlertCounts,
  Attachment,
  BackupInfo,
  DictItem,
  PageResult,
  Project,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectLog,
  ProjectStatus,
  ProjectUpdateInput,
  StatsOverview
} from './types'
import type { ProjectAlert } from './alerts'

/** 运行环境自检信息 */
export interface AppInfo {
  name: string
  version: string
  isPackaged: boolean
  electron: string
  node: string
  chrome: string
  dbPath: string
  userData: string
  sqliteAvailable: boolean
}

/**
 * 渲染进程能看到的全部能力。
 * preload 负责实现，界面只通过 window.api 使用 —— 不暴露 ipcRenderer 本身。
 */
export interface RendererApi {
  app: {
    info(): Promise<AppInfo>
  }
  project: {
    list(query: ProjectListQuery): Promise<PageResult<Project>>
    get(id: string): Promise<Project | null>
    create(input: ProjectCreateInput): Promise<ActionResult<Project>>
    update(id: string, patch: ProjectUpdateInput): Promise<ActionResult<Project>>
    changeStatus(
      id: string,
      to: ProjectStatus,
      payload: AdvancePayload
    ): Promise<ActionResult<Project>>
    remove(id: string): Promise<ActionResult>
    checkTaskNo(
      taskNo: string,
      excludeId?: string
    ): Promise<ActionResult<{ value: string; prefixWarning?: string }>>
    allowedTargets(id: string): Promise<ProjectStatus[]>
    countByStatus(): Promise<Record<string, number>>
    clients(): Promise<string[]>
    logs(id: string): Promise<ProjectLog[]>
    recentLogs(limit?: number): Promise<Array<ProjectLog & { project_name?: string }>>
    /** 按当前筛选条件导出项目明细台账到 Excel；主进程弹保存框 */
    exportExcel(
      query: ProjectListQuery,
      outPath?: string
    ): Promise<ActionResult<{ path: string; rows: number }>>
  }
  /** 待办提醒 / 超期预警（实时算出来的，不落库） */
  alert: {
    list(): Promise<ProjectAlert[]>
    counts(): Promise<AlertCounts>
  }
  /** 现场照片 / 附件 */
  attachment: {
    list(projectId: string): Promise<Attachment[]>
    /** 弹系统多选框选择照片并归档；返回本次新增的条目 */
    add(projectId: string): Promise<ActionResult<Attachment[]>>
    remove(attachmentId: string): Promise<ActionResult>
    /** 各项目的照片数，列表页显示"照片 N 张"用 */
    counts(): Promise<Record<string, number>>
    /**
     * ⚠️ 仅自动化测试存在的能力：直接给磁盘路径灌照片。
     *
     * 系统文件选择框没法在 e2e 里点，所以测试需要一个绕过对话框的入口。
     * 但它等价于"让页面读任意文件"，属于比 nodeIntegration 更直接的破口，
     * 因此主进程 handler 与 preload 暴露两端**各自**用 FWJC_TEST_HOOKS=1 包住：
     * 没有这个环境变量时，这一项在 window.api 上是 undefined，通道也没有 handler。
     */
    __testAddByPaths?(projectId: string, paths: string[]): Promise<ActionResult<Attachment[]>>
  }
  dict: {
    bundle(types: string[]): Promise<Record<string, DictItem[]>>
    list(type: string, onlyEnabled?: boolean): Promise<DictItem[]>
  }
  setting: {
    getAll(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<boolean>
  }
  /** 统计报表（4 个维度一次查回来，切时间范围整体刷新） */
  stats: {
    overview(months?: number): Promise<StatsOverview>
  }
  /** 数据备份与恢复 */
  backup: {
    info(): Promise<BackupInfo>
    /** 弹保存框导出备份包；outPath 仅在测试钩子开启时被采纳 */
    create(
      outPath?: string
    ): Promise<ActionResult<{ path: string; bytes: number; photoCount: number }>>
    /** 弹选择框选备份包并回显信息（也可以直接传路径，测试用） */
    inspect(zipPath?: string): Promise<{
      ok: boolean
      message: string
      path?: string
      fileName?: string
      createdAt?: string
      photoCount?: number
      dbBytes?: number
    }>
    /** 执行恢复。恢复前会自动把现有数据备份到 <userData>/backups */
    restore(
      zipPath: string
    ): Promise<ActionResult<{ photoCount: number; safetyBackup: string }>>
  }
}
