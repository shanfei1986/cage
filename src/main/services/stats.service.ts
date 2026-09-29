import { todayLocal } from '@shared/datetime'
import { firstDayOfMonth, mergeTrend, monthKeys } from '@shared/stats'
import type { ProjectStatus, StatsOverview } from '@shared/types'
import { dictLabel } from '../db/repositories/dict.repo'
import * as statsRepo from '../db/repositories/stats.repo'

/** 默认看最近 6 个月，够看出季节波动，又不至于把折线挤成一条 */
export const DEFAULT_STATS_MONTHS = 6
export const MAX_STATS_MONTHS = 36

function round1(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null
  return Math.round(v * 10) / 10
}

/**
 * 一次把 4 个维度的数据查齐。
 *
 * 为什么不做成 4 个独立接口：界面上切换时间范围时希望整体一起刷新，
 * 分批取会出现"折线已经变了、饼图还是旧的"这种半新半旧的状态。
 * 单机 SQLite + 几千条数据，一次查完远快于 4 次 IPC 往返。
 */
export function getStatsOverview(months: number = DEFAULT_STATS_MONTHS): StatsOverview {
  const n = Math.max(1, Math.min(MAX_STATS_MONTHS, Math.floor(months) || DEFAULT_STATS_MONTHS))
  const today = todayLocal()
  const keys = monthKeys(n, today)
  const since = firstDayOfMonth(keys[0])

  const trend = mergeTrend(
    keys,
    statsRepo.countReceivedByMonth(since),
    statsRepo.countIssuedByMonth(since)
  )

  const byProjectType = statsRepo
    .countByProjectType()
    .map((r) => ({
      code: r.code,
      label: r.code ? dictLabel('project_type', r.code) : '未填写',
      count: Number(r.count)
    }))
    .filter((r) => r.count > 0)

  const byStatus = statsRepo.countByStatus().map((r) => ({
    status: r.status as ProjectStatus,
    count: Number(r.count)
  }))

  const overdue = statsRepo.reportOverdueStats()
  const reportOverdueRate = overdue.total > 0 ? overdue.overdue / overdue.total : null

  return {
    range: { months: n, since },
    trend,
    byProjectType,
    byStatus,
    cycle: {
      avgReceiveToTest: round1(statsRepo.avgReceiveToTest()),
      avgReceiveToReport: round1(statsRepo.avgReceiveToReport()),
      reportOverdueIssued: overdue.overdue,
      reportIssuedWithDue: overdue.total,
      reportOverdueRate,
      reportOverdueOpen: statsRepo.countReportOverdueOpen(today)
    }
  }
}
