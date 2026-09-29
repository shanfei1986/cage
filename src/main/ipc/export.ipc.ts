import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ActionResult, ProjectListQuery } from '@shared/types'
import { nowLocal } from '@shared/datetime'
import { dictLabel } from '../db/repositories/dict.repo'
import { getSetting } from '../db/repositories/setting.repo'
import { listProjectsForExport } from '../services/project.service'
import { buildProjectWorkbook, type ExcelLabels } from '../services/excel.service'

/** 把设置表里的单位名称 + 字典翻译组装成导出用的标签集 */
function buildLabels(): ExcelLabels {
  return {
    orgName: (getSetting('org.name') ?? '').trim(),
    generatedAt: nowLocal(),
    projectType: (code) => dictLabel('project_type', code),
    testCategory: (code) => dictLabel('test_category', code),
    source: (code) => dictLabel('source', code)
  }
}

/** 默认文件名：检测项目台账-20261020-1530.xlsx */
function defaultFileName(): string {
  const t = nowLocal().replace(/[-: ]/g, '')
  return `检测项目台账-${t.slice(0, 8)}-${t.slice(8, 12)}.xlsx`
}

export function registerExportIpc(): void {
  /**
   * 导出项目明细台账。
   *
   * outPath 只在测试钩子开启时才被采纳 —— 否则等于给了渲染层"往任意路径写文件"
   * 的能力，那是比开 nodeIntegration 更直接的安全破口。正式运行时一律弹保存框。
   */
  ipcMain.handle(
    'export:projectsExcel',
    async (
      e,
      rawQuery: ProjectListQuery,
      outPath?: string
    ): Promise<ActionResult<{ path: string; rows: number }>> => {
      try {
        // 导出的是"当前筛选条件下的全部匹配项目"，不是当前页 —— 否则导 20 条
        // 用户会以为筛选失效了
        const query: ProjectListQuery = { ...(rawQuery ?? {}), page: 1, pageSize: 200 }
        const rows = listProjectsForExport(query)

        const testHooks = process.env.FWJC_TEST_HOOKS === '1'
        let target = testHooks && outPath ? outPath : ''

        if (!target) {
          const options = {
            title: '导出项目台账',
            defaultPath: defaultFileName(),
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          }
          const win = BrowserWindow.fromWebContents(e.sender)
          // 有窗口就挂成模态子窗口，没有就退回无父窗口的对话框
          const res = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options)
          if (res.canceled || !res.filePath) {
            return { ok: false, message: '已取消导出' }
          }
          target = res.filePath
        }

        const buffer = await buildProjectWorkbook(rows, buildLabels())
        writeFileSync(target, buffer)

        return {
          ok: true,
          data: { path: target, rows: rows.length },
          message: `已导出 ${rows.length} 个项目到 ${basename(target)}`
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
