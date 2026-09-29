import type { ProjectStatus } from './types'
import { STATUS_LABEL } from './projectStatus'

/**
 * 统计报表的纯计算部分。
 *
 * 放 shared 而不是 service 里，是为了让自检脚本能在不碰数据库的情况下
 * 直接验算月份补齐、比例计算这些最容易算错的逻辑 —— 聚合口径错了，
 * 界面上看起来一切正常，只是数字不对，这类 bug 只能靠单测兜住。
 */

/** 把 'YYYY-MM' 拆成 { y, m }；格式不对返回 null */
function parseYm(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return null
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  return { y: Number(m[1]), m: mm }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * 生成连续的月份键，以 today 所在月为最后一个月，往前共 months 个。
 * 例：monthKeys(6, '2026-10-20') → ['2026-05' … '2026-10']
 *
 * 必须做这一步：SQL 的 GROUP BY 只会返回"有数据的月份"，
 * 中间空档的月份若在前端直接补 0，一条 5 个月的折线会变成 3 个点。
 */
export function monthKeys(months: number, today: string): string[] {
  const n = Math.max(1, Math.min(36, Math.floor(months) || 1))
  const base = /^(\d{4})-(\d{2})/.exec(today)
  const y = base ? Number(base[1]) : new Date().getFullYear()
  const m = base ? Number(base[2]) : new Date().getMonth() + 1

  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    // 用 0 基的"月序号"做加减，避免 12→1 的跨年手算出错
    const total = y * 12 + (m - 1) - i
    out.push(`${Math.floor(total / 12)}-${pad((total % 12) + 1)}`)
  }
  return out
}

/** 月份区间起始日（'YYYY-MM-01'），用作 SQL 的比较下界 */
export function firstDayOfMonth(ym: string): string {
  return `${ym}-01`
}

export interface TrendPoint {
  ym: string
  received: number
  issued: number
}

/** 把稀疏的按月计数补齐成连续的折线数据 */
export function mergeTrend(
  keys: string[],
  received: Array<{ ym: string; c: number }>,
  issued: Array<{ ym: string; c: number }>
): TrendPoint[] {
  const rMap = new Map(received.map((r) => [r.ym, Number(r.c)]))
  const iMap = new Map(issued.map((r) => [r.ym, Number(r.c)]))
  return keys.map((ym) => ({
    ym,
    received: rMap.get(ym) ?? 0,
    issued: iMap.get(ym) ?? 0
  }))
}

/** 柱状图/流程条用的阶段顺序：主流程在前，旁支在后 */
export const STATUS_CHART_ORDER: ProjectStatus[] = [
  'received',
  'contacted',
  'scheduled',
  'testing',
  'organizing',
  'reporting',
  'report_issued',
  'closed',
  'paused',
  'cancelled'
]

/** 取阶段中文名；传进来的 code 不在表里时原样返回，界面上不会出现空白 */
export function statusLabelOf(status: string): string {
  return STATUS_LABEL[status as ProjectStatus] ?? status
}

/** 把平均天数整理成展示文本；无样本时明确写"暂无数据"，不要显示 0 天 */
export function formatAvgDays(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '暂无数据'
  return `${v.toFixed(1)} 天`
}

/** 比例 → 百分比文本；无样本返回 '—' */
export function formatRate(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

export { parseYm }
