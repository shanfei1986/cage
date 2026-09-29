import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionResult,
  AdvancePayload,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectStatus,
  ProjectUpdateInput
} from '@shared/types'
import type { AppInfo, RendererApi } from '@shared/api'

/**
 * 只暴露具名方法，绝不把 ipcRenderer 丢给渲染进程 ——
 * 否则界面里任何一段脚本都能往任意通道发消息，安全性就没了。
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
    recentLogs: (limit?: number) => ipcRenderer.invoke('project:recentLogs', limit)
  },

  dict: {
    bundle: (types: string[]) => ipcRenderer.invoke('dict:bundle', types),
    list: (type: string, onlyEnabled?: boolean) => ipcRenderer.invoke('dict:list', type, onlyEnabled)
  },

  setting: {
    getAll: () => ipcRenderer.invoke('setting:getAll'),
    set: (key: string, value: string) => ipcRenderer.invoke('setting:set', key, value)
  }
}

contextBridge.exposeInMainWorld('api', api)
