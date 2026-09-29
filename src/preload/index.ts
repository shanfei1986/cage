import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionResult,
  AdvancePayload,
  Attachment,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectStatus,
  ProjectUpdateInput
} from '@shared/types'
import type { AppInfo, RendererApi } from '@shared/api'

/**
 * 只暴露具名方法，绝不把 ipcRenderer 丢给渲染进程 ——
 * 否则界面里任何一段脚本都能往任意通道发消息，安全性就没了。
 *
 * 注意：sandbox: true 的 preload 仍然读得到 process.env（已验证），
 * 所以测试钩子可以在这一层按环境变量开关，不必把开关塞进构建参数。
 */
const api: RendererApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>
  },

  project: {
    list: (query: ProjectListQuery) => ipcRenderer.invoke('project:list', query),
    get: (id: string) => ipcRenderer.invoke('project:get', id),
    create: (input: ProjectCreateInput) => ipcRenderer.invoke('project:create', input),
    update: (id: string, patch: ProjectUpdateInput) =>
      ipcRenderer.invoke('project:update', id, patch),
    changeStatus: (id: string, to: ProjectStatus, payload: AdvancePayload) =>
      ipcRenderer.invoke('project:changeStatus', id, to, payload),
    remove: (id: string) => ipcRenderer.invoke('project:remove', id) as Promise<ActionResult>,
    checkTaskNo: (taskNo: string, excludeId?: string) =>
      ipcRenderer.invoke('project:checkTaskNo', taskNo, excludeId),
    allowedTargets: (id: string) => ipcRenderer.invoke('project:allowedTargets', id),
    countByStatus: () => ipcRenderer.invoke('project:countByStatus'),
    clients: () => ipcRenderer.invoke('project:clients'),
    logs: (id: string) => ipcRenderer.invoke('project:logs', id),
    recentLogs: (limit?: number) => ipcRenderer.invoke('project:recentLogs', limit),
    exportExcel: (query: ProjectListQuery, outPath?: string) =>
      ipcRenderer.invoke('export:projectsExcel', query, outPath)
  },

  alert: {
    list: () => ipcRenderer.invoke('alert:list'),
    counts: () => ipcRenderer.invoke('alert:counts')
  },

  attachment: {
    list: (projectId: string) => ipcRenderer.invoke('attachment:list', projectId),
    add: (projectId: string) => ipcRenderer.invoke('attachment:add', projectId),
    remove: (attachmentId: string) => ipcRenderer.invoke('attachment:remove', attachmentId),
    counts: () => ipcRenderer.invoke('attachment:counts')
  },

  dict: {
    bundle: (types: string[]) => ipcRenderer.invoke('dict:bundle', types),
    list: (type: string, onlyEnabled?: boolean) => ipcRenderer.invoke('dict:list', type, onlyEnabled)
  },

  setting: {
    getAll: () => ipcRenderer.invoke('setting:getAll'),
    set: (key: string, value: string) => ipcRenderer.invoke('setting:set', key, value)
  },

  stats: {
    overview: (months?: number) => ipcRenderer.invoke('stats:overview', months)
  },

  backup: {
    info: () => ipcRenderer.invoke('backup:info'),
    create: (outPath?: string) => ipcRenderer.invoke('backup:create', outPath),
    inspect: (zipPath?: string) => ipcRenderer.invoke('backup:inspect', zipPath),
    restore: (zipPath: string) => ipcRenderer.invoke('backup:restore', zipPath)
  }
}

/**
 * 测试钩子：给渲染层一个"绕过系统文件选择框"的入口，仅供 e2e 使用。
 * 主进程那边也有同名的环境变量守卫，两边缺一不可 —— 少一边就等于把
 * "读任意路径文件"顺手送给了页面脚本。生产打包时没有这个变量。
 */
if (process.env['FWJC_TEST_HOOKS'] === '1') {
  api.attachment.__testAddByPaths = (
    projectId: string,
    paths: string[]
  ): Promise<ActionResult<Attachment[]>> =>
    ipcRenderer.invoke('attachment:__testAddByPaths', projectId, paths)
}

contextBridge.exposeInMainWorld('api', api)
