import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { IMAGE_EXTENSIONS } from '@shared/attachment'
import * as svc from '../services/attachment.service'

export function registerAttachmentIpc(): void {
  ipcMain.handle('attachment:list', (_e, projectId: string) => svc.list(projectId))

  /**
   * 选择并添加照片。
   *
   * 用主进程的 dialog 而不是渲染层的 <input type="file">：
   * 1. Electron 32 起 File.path 已被移除，取真实路径要走 webUtils，跨版本行为要单独验证；
   * 2. 更重要的是，**磁盘路径自始至终不交给渲染层**，官方也明确建议不要把完整路径暴露给网页内容。
   */
  ipcMain.handle('attachment:add', async (e, projectId: string) => {
    const options: OpenDialogOptions = {
      title: '选择现场照片',
      buttonLabel: '添加',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片', extensions: [...IMAGE_EXTENSIONS] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false, message: '已取消' }
    }
    return svc.addByPaths(projectId, res.filePaths)
  })

  ipcMain.handle('attachment:remove', (_e, attachmentId: string) => svc.remove(attachmentId))

  /** 各项目的照片数，列表页显示用。一次取全量，避免每行一次 IPC。 */
  ipcMain.handle('attachment:counts', () => svc.countsByProject())

  /**
   * ⚠️ 测试专用钩子：允许渲染层直接传磁盘路径。
   *
   * 这等于把"读任意文件"的能力交给渲染层，是比 nodeIntegration: true 更直接的破口，
   * 所以必须用环境变量包住注册 —— 生产打包时 FWJC_TEST_HOOKS 不存在，
   * 这个通道根本没有 handler，渲染层调用只会得到 "No handler registered"。
   * e2e 里有一条回归断言专门守这个。
   */
  if (process.env.FWJC_TEST_HOOKS === '1') {
    ipcMain.handle(
      'attachment:__testAddByPaths',
      (_e, projectId: string, paths: string[]) => svc.addByPaths(projectId, paths)
    )
  }
}
