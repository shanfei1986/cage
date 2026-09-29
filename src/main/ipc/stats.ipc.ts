import { ipcMain } from 'electron'
import { DEFAULT_STATS_MONTHS, MAX_STATS_MONTHS, getStatsOverview } from '../services/stats.service'

export function registerStatsIpc(): void {
  /**
   * 统计报表总览。
   * months 由界面传入（6 / 12 / 24），这里做一次夹紧，不让渲染层传进离谱的值
   * 把 SQL 的扫描范围拉成十年。
   */
  ipcMain.handle('stats:overview', (_e, months?: number) => {
    const n = Number(months)
    return getStatsOverview(
      Number.isFinite(n) && n > 0 ? Math.min(MAX_STATS_MONTHS, Math.floor(n)) : DEFAULT_STATS_MONTHS
    )
  })
}
