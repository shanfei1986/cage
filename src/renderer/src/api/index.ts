import type {
  AdvancePayload,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectStatus,
  ProjectUpdateInput
} from '@shared/types'
import type { RendererApi } from '@shared/api'

/**
 * 渲染层对 preload 暴露的 window.api 再包一层薄封装。
 * 页面只调这里，不直接碰 window.api —— 以后要改通道名或加日志，只改这一个文件。
 */

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // IPC 层抛出的异常在界面上原样透出会很难懂，统一包装一下
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg.replace(/^Error invoking remote method '[^']+':\s*/, ''))
  }
}

/**
 * 显式标注 RendererApi：这样 preload 与渲染层两边的方法签名被同一份接口约束，
 * 加通道时漏一处 TS 就会报错，不会等到运行时才 "is not a function"。
 */
export const api: RendererApi = {
  app: {
    info: () => call(() => window.api.app.info())
  },

  project: {
    list: (query: ProjectListQuery) => call(() => window.api.project.list(query)),
    get: (id: string) => call(() => window.api.project.get(id)),
    create: (input: ProjectCreateInput) => call(() => window.api.project.create(input)),
    update: (id: string, patch: ProjectUpdateInput) =>
      call(() => window.api.project.update(id, patch)),
    changeStatus: (id: string, to: ProjectStatus, payload: AdvancePayload = {}) =>
      call(() => window.api.project.changeStatus(id, to, payload)),
    remove: (id: string) => call(() => window.api.project.remove(id)),
    checkTaskNo: (taskNo: string, excludeId?: string) =>
      call(() => window.api.project.checkTaskNo(taskNo, excludeId)),
    allowedTargets: (id: string) => call(() => window.api.project.allowedTargets(id)),
    countByStatus: () => call(() => window.api.project.countByStatus()),
    clients: () => call(() => window.api.project.clients()),
    logs: (id: string) => call(() => window.api.project.logs(id)),
    recentLogs: (limit?: number) => call(() => window.api.project.recentLogs(limit)),
    exportExcel: (query: ProjectListQuery, outPath?: string) =>
      call(() => window.api.project.exportExcel(query, outPath))
  },

  alert: {
    list: () => call(() => window.api.alert.list()),
    counts: () => call(() => window.api.alert.counts())
  },

  attachment: {
    list: (projectId: string) => call(() => window.api.attachment.list(projectId)),
    add: (projectId: string) => call(() => window.api.attachment.add(projectId)),
    remove: (attachmentId: string) => call(() => window.api.attachment.remove(attachmentId)),
    counts: () => call(() => window.api.attachment.counts())
  },

  dict: {
    bundle: (types: string[]) => call(() => window.api.dict.bundle(types)),
    list: (type: string, onlyEnabled?: boolean) =>
      call(() => window.api.dict.list(type, onlyEnabled))
  },

  setting: {
    getAll: () => call(() => window.api.setting.getAll()),
    set: (key: string, value: string) => call(() => window.api.setting.set(key, value))
  },

  stats: {
    overview: (months?: number) => call(() => window.api.stats.overview(months))
  },

  backup: {
    info: () => call(() => window.api.backup.info()),
    create: (outPath?: string) => call(() => window.api.backup.create(outPath)),
    inspect: (zipPath?: string) => call(() => window.api.backup.inspect(zipPath)),
    restore: (zipPath: string) => call(() => window.api.backup.restore(zipPath))
  }
}

export default api
