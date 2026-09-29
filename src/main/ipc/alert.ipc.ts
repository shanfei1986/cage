import { ipcMain } from 'electron'
import { getAlertCounts, getAlerts } from '../services/alert.service'

/**
 * 待办提醒 / 超期预警。
 * 只读接口 —— 预警是算出来的，不落库，所以没有写操作。
 */
export function registerAlertIpc(): void {
  ipcMain.handle('alert:list', () => getAlerts())
  ipcMain.handle('alert:counts', () => getAlertCounts())
}
