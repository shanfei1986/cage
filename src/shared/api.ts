import type {
  ActionResult,
  AdvancePayload,
  DictItem,
  PageResult,
  Project,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectLog,
  ProjectStatus,
  ProjectUpdateInput
} from './types'

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
  }
  dict: {
    bundle(types: string[]): Promise<Record<string, DictItem[]>>
    list(type: string, onlyEnabled?: boolean): Promise<DictItem[]>
  }
  setting: {
    getAll(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<boolean>
  }
}
