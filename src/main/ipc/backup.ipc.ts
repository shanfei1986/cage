import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import { nowLocal } from '@shared/datetime'
import type { ActionResult, BackupInfo } from '@shared/types'
import { getSetting, setSetting } from '../db/repositories/setting.repo'
import {
  backupIncludes,
  createBackup,
  defaultBackupFileName,
  inspectBackup,
  restoreBackup
} from '../services/backup.service'

/**
 * 备份 / 恢复的 IPC。
 *
 * 两个写路径都只在 e2e 时才接受调用方传入的路径，正式运行一律弹系统对话框 ——
 * 否则渲染层就能往任意路径写文件、或从任意路径读文件覆盖数据库。
 *
 * safetyDir（恢复前的自动备份）固定放在 <userData>/backups，不给界面选择权：
 * 它存在的意义是"出事能回退"，位置飘忽反而会找不到。
 */
export function registerBackupIpc(safetyDir: string): void {
  ipcMain.handle(
    'backup:info',
    (): BackupInfo => ({
      lastBackupAt: getSetting('db.last_backup_at') ?? '',
      lastRestoreAt: getSetting('db.last_restore_at') ?? '',
      includes: backupIncludes()
    })
  )

  ipcMain.handle(
    'backup:create',
    async (e, outPath?: string): Promise<ActionResult<{ path: string; bytes: number; photoCount: number }>> => {
      try {
        const testHooks = process.env.FWJC_TEST_HOOKS === '1'
        let target = testHooks && outPath ? outPath : ''

        if (!target) {
          const options = {
            title: '导出数据备份',
            defaultPath: defaultBackupFileName(),
            filters: [{ name: '备份包', extensions: ['zip'] }]
          }
          const win = BrowserWindow.fromWebContents(e.sender)
          const res = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options)
          if (res.canceled || !res.filePath) return { ok: false, message: '已取消备份' }
          target = res.filePath
        }

        const r = createBackup(target)
        setSetting('db.last_backup_at', nowLocal())

        return {
          ok: true,
          data: { path: r.path, bytes: r.bytes, photoCount: r.photoCount },
          message: `已备份到 ${basename(r.path)}（含 ${r.photoCount} 张现场照片）`
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  /** 选中备份包后先看一眼，把"哪天备的、有多少照片"回显给用户，再让他确认 */
  ipcMain.handle('backup:inspect', async (e, zipPath?: string) => {
    let target = zipPath ?? ''
    if (!target) {
      const options = {
        title: '选择要恢复的备份包',
        filters: [{ name: '备份包', extensions: ['zip'] }],
        properties: ['openFile' as const]
      }
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (res.canceled || res.filePaths.length === 0) return { ok: false, message: '已取消' }
      target = res.filePaths[0]
    }
    const info = inspectBackup(target)
    return { ...info, path: target, fileName: basename(target) }
  })

  /**
   * 执行恢复。
   *
   * 调用方必须先走完"输入『恢复』两字二次确认"，这里不再拦 —— 但也正因如此，
   * 消息里要把自动备份的位置报出来，用户事后找得着。
   */
  ipcMain.handle(
    'backup:restore',
    async (e, zipPath: string): Promise<ActionResult<{ photoCount: number; safetyBackup: string }>> => {
      try {
        if (!zipPath) return { ok: false, message: '没有指定备份包' }
        const r = restoreBackup(zipPath, safetyDir)
        setSetting('db.last_restore_at', nowLocal())
        return {
          ok: true,
          data: { photoCount: r.photoCount, safetyBackup: r.safetyBackup },
          message: `已从备份恢复（含 ${r.photoCount} 张现场照片）。恢复前的数据已另存为 ${basename(r.safetyBackup)}`
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
