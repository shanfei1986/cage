import { ipcMain } from 'electron'
import type {
  AdvancePayload,
  ProjectCreateInput,
  ProjectListQuery,
  ProjectStatus,
  ProjectUpdateInput
} from '@shared/types'
import * as svc from '../services/project.service'
import { countByStatus, listClients } from '../db/repositories/project.repo'
import { listLogs, listRecentLogs } from '../db/repositories/log.repo'

export function registerProjectIpc(): void {
  ipcMain.handle('project:list', (_e, query: ProjectListQuery) => svc.listProjects(query ?? {}))
  ipcMain.handle('project:get', (_e, id: string) => svc.getProject(id))
  ipcMain.handle('project:create', (_e, input: ProjectCreateInput) => svc.createProject(input))
  ipcMain.handle('project:update', (_e, id: string, patch: ProjectUpdateInput) =>
    svc.updateProject(id, patch)
  )
  ipcMain.handle('project:changeStatus', (_e, id: string, to: ProjectStatus, payload: AdvancePayload) =>
    svc.changeStatus(id, to, payload ?? {})
  )
  ipcMain.handle('project:remove', (_e, id: string) => svc.removeProject(id))

  // 表单实时校验 / 辅助数据
  ipcMain.handle('project:checkTaskNo', (_e, taskNo: string, excludeId?: string) =>
    svc.checkTaskNo(taskNo, excludeId)
  )
  ipcMain.handle('project:allowedTargets', (_e, id: string) => {
    const p = svc.getProject(id)
    return p ? svc.allowedTargets(p) : []
  })
  ipcMain.handle('project:countByStatus', () => countByStatus())
  ipcMain.handle('project:clients', () => listClients())

  // 时间轴
  ipcMain.handle('project:logs', (_e, id: string) => listLogs(id))
  ipcMain.handle('project:recentLogs', (_e, limit?: number) => listRecentLogs(limit ?? 20))
}
