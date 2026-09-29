import { app, ipcMain } from 'electron'
import { getDbPath } from '../db/connection'
import { isNodeSqliteAvailable } from '../db/driver'
import { registerProjectIpc } from './project.ipc'
import { registerDictIpc, registerSettingIpc } from './setting.ipc'

/**
 * 统一注册入口。以后加领域就加一个 registerXxxIpc()，在主进程启动时调用一次。
 * 通道命名约定：<domain>:<action>，例如 project:changeStatus。
 */
export function registerIpc(): void {
  registerProjectIpc()
  registerSettingIpc()
  registerDictIpc()

  // 运行环境自检信息，设置页"关于"里展示，也方便排查问题
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    dbPath: getDbPath(),
    userData: app.getPath('userData'),
    sqliteAvailable: isNodeSqliteAvailable()
  }))
}
