import ExcelJS from 'exceljs'
import type { Project } from '@shared/types'
import {
  REPORT_STATUS_LABEL,
  STATUS_LABEL,
  TEST_STATUS_LABEL
} from '@shared/projectStatus'
import { diffDays, todayLocal } from '@shared/datetime'

/**
 * 项目台账 Excel 生成。
 *
 * 刻意不 import electron：这样纯 Node 的自检脚本能直接跑它，验证表头、
 * 行数、文件头是不是真的对（导出功能最容易"看起来成功、打开才发现是空表"）。
 * 保存路径由调用方（IPC 层）通过 dialog 拿到后传进来。
 */

export interface ExcelLabels {
  orgName: string
  generatedAt: string
  projectType: (code: string | null) => string
  testCategory: (code: string | null) => string
  source: (code: string | null) => string
}

/** 列定义：表头 + 取值。顺序即导出顺序。 */
type ColumnDef = {
  header: string
  width: number
  value: (p: Project, l: ExcelLabels) => string | number | null
}

const COLUMNS: ColumnDef[] = [
  { header: '任务单号', width: 12, value: (p) => p.task_no },
  { header: '项目名称', width: 32, value: (p) => p.name },
  { header: '委托方', width: 24, value: (p) => p.client_name },
  { header: '联系人', width: 12, value: (p) => p.client_contact },
  { header: '联系电话', width: 16, value: (p) => p.client_phone },
  { header: '项目地址', width: 32, value: (p) => p.project_address },
  { header: '业务类型', width: 20, value: (p, l) => l.projectType(p.project_type) },
  { header: '检测类别', width: 14, value: (p, l) => l.testCategory(p.test_category) },
  { header: '任务来源', width: 14, value: (p, l) => l.source(p.source) },
  { header: '栋数', width: 8, value: (p) => p.building_count },
  { header: '建筑面积(㎡)', width: 14, value: (p) => p.building_area },
  { header: '层数', width: 16, value: (p) => p.floors },
  { header: '结构形式', width: 14, value: (p) => p.struct_type },
  { header: '负责人', width: 10, value: (p) => p.handler },
  { header: '检测人员', width: 16, value: (p) => p.testers },
  { header: '当前阶段', width: 14, value: (p) => STATUS_LABEL[p.status] },
  { header: '检测情况', width: 12, value: (p) => TEST_STATUS_LABEL[p.test_status] },
  { header: '进场次数', width: 10, value: (p) => p.test_round },
  { header: '接单日期', width: 12, value: (p) => p.receive_date },
  { header: '要求完成日期', width: 14, value: (p) => p.expect_finish_date },
  { header: '约定检测日期', width: 14, value: (p) => p.plan_test_date },
  { header: '实际进场日期', width: 14, value: (p) => p.actual_test_date },
  { header: '报告应出日期', width: 14, value: (p) => p.report_due_date },
  { header: '报告编号', width: 26, value: (p) => p.report_no },
  { header: '报告状态', width: 12, value: (p) => REPORT_STATUS_LABEL[p.report_status] },
  { header: '报告出具日期', width: 14, value: (p) => p.report_issue_date },
  {
    header: '报告是否超期',
    width: 14,
    value: (p) => {
      if (!p.report_due_date) return ''
      // 已出报告：看实际出具日有没有超过应出日；未出报告：看应出日是不是已经过了
      const base = p.report_issue_date
      const d = base
        ? diffDays(p.report_due_date, base)
        : diffDays(p.report_due_date, todayLocal())
      if (d === null) return ''
      if (d > 0) return `超期 ${d} 天`
      return base ? '按时' : '未超期'
    }
  },
  { header: '联系记录', width: 30, value: (p) => p.contact_note },
  { header: '整理记录', width: 30, value: (p) => p.organize_note },
  { header: '待补事项/检测说明', width: 30, value: (p) => p.test_remark },
  { header: '暂缓原因', width: 20, value: (p) => p.pause_reason },
  { header: '取消原因', width: 20, value: (p) => p.cancel_reason },
  { header: '备注', width: 24, value: (p) => p.remark },
  { header: '建档时间', width: 20, value: (p) => p.created_at },
  { header: '最后更新', width: 20, value: (p) => p.updated_at },
  { header: '归档时间', width: 20, value: (p) => p.closed_at }
]

export const SHEET_NAME = '项目台账'

/**
 * 生成工作簿。返回 Buffer，由调用方写盘。
 * 结构：标题行 → 副标题行 → 表头行 → 数据行。
 */
export async function buildProjectWorkbook(
  rows: Project[],
  labels: ExcelLabels
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = labels.orgName || '检测项目管理系统'
  wb.created = new Date()

  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 3 }] // 冻结前 3 行，往下滚时表头始终可见
  })

  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))

  // 标题：单位名称 + 报表名
  const title = labels.orgName ? `${labels.orgName} 项目台账` : '项目台账'
  const titleRow = ws.insertRow(1, [title])
  titleRow.font = { bold: true, size: 14 }
  titleRow.height = 24
  ws.mergeCells(1, 1, 1, COLUMNS.length)

  const subRow = ws.insertRow(2, [
    `导出时间：${labels.generatedAt}    共 ${rows.length} 个项目`
  ])
  subRow.font = { size: 10, color: { argb: 'FF666666' } }
  ws.mergeCells(2, 1, 2, COLUMNS.length)

  // 表头样式（第 3 行由 columns.header 自动写入）
  const headerRow = ws.getRow(3)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 20
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FF' } }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
    }
  })

  for (const p of rows) {
    ws.addRow(COLUMNS.map((c) => c.value(p, labels) ?? ''))
  }

  // 数据区统一加边框，方便直接打印
  for (let r = 4; r <= 3 + rows.length; r++) {
    ws.getRow(r).eachCell((cell) => {
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        left: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        right: { style: 'hair', color: { argb: 'FFBFBFBF' } }
      }
    })
  }

  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

/** DataGrid 里展示的列数（供自检断言用，避免两处各写一个数字） */
export const EXPORT_COLUMN_COUNT = COLUMNS.length
