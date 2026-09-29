import { getDb } from '../connection'

/**
 * 统计报表的数据来源。
 *
 * 口径统一写在最上面，界面上的脚注要跟这里保持一致：
 * - 「按月趋势」与「业务类型分布」排除已取消项目 —— 取消的单子不算实际工作量；
 * - 「当前阶段分布」不过滤 —— 取消/归档占多少本身就是想知道的信息；
 * - 「周期与超期率」只在填了对应日期的样本上算平均数，样本为 0 时返回 null，
 *   绝不用 0 冒充"平均 0 天"，那会把报表讲歪。
 *
 * 日期都是 'YYYY-MM-DD' 文本，用 julianday() 相减得到天数差。
 * 只在 actual_test_date >= receive_date 这类顺序正确的样本上取平均，
 * 避免脏数据（手误把接单日期填成未来）把平均值拉飞。
 */

export interface YmCount {
  ym: string
  c: number
}

/** 按月接单量（排除已取消） */
export function countReceivedByMonth(since: string): YmCount[] {
  return getDb().all<YmCount>(
    `SELECT substr(receive_date, 1, 7) AS ym, COUNT(*) AS c
       FROM project
      WHERE receive_date IS NOT NULL
        AND receive_date >= ?
        AND status <> 'cancelled'
      GROUP BY ym
      ORDER BY ym`,
    since
  )
}

/** 按月报告出具量（按报告实际出具日期；排除已取消） */
export function countIssuedByMonth(since: string): YmCount[] {
  return getDb().all<YmCount>(
    `SELECT substr(report_issue_date, 1, 7) AS ym, COUNT(*) AS c
       FROM project
      WHERE report_issue_date IS NOT NULL
        AND report_issue_date >= ?
        AND status <> 'cancelled'
      GROUP BY ym
      ORDER BY ym`,
    since
  )
}

/** 按业务类型分布（排除已取消） */
export function countByProjectType(): Array<{ code: string | null; count: number }> {
  return getDb().all<{ code: string | null; count: number }>(
    `SELECT project_type AS code, COUNT(*) AS count
       FROM project
      WHERE status <> 'cancelled'
      GROUP BY project_type
      ORDER BY count DESC`
  )
}

/** 按当前阶段分布（不过滤，取消/归档也要看得到） */
export function countByStatus(): Array<{ status: string; count: number }> {
  return getDb().all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM project GROUP BY status ORDER BY count DESC'
  )
}

/** 接单 → 实际进场 的平均天数；无有效样本返回 null */
export function avgReceiveToTest(): number | null {
  const row = getDb().get<{ v: number | null }>(
    `SELECT AVG(julianday(actual_test_date) - julianday(receive_date)) AS v
       FROM project
      WHERE receive_date IS NOT NULL
        AND actual_test_date IS NOT NULL
        AND julianday(actual_test_date) >= julianday(receive_date)`
  )
  return row?.v ?? null
}

/** 接单 → 报告出具 的平均天数；无有效样本返回 null */
export function avgReceiveToReport(): number | null {
  const row = getDb().get<{ v: number | null }>(
    `SELECT AVG(julianday(report_issue_date) - julianday(receive_date)) AS v
       FROM project
      WHERE receive_date IS NOT NULL
        AND report_issue_date IS NOT NULL
        AND julianday(report_issue_date) >= julianday(receive_date)`
  )
  return row?.v ?? null
}

/** 已出具报告中：超期份数 / 有应出日期的总份数 */
export function reportOverdueStats(): { overdue: number; total: number } {
  const row = getDb().get<{ overdue: number; total: number }>(
    `SELECT
       SUM(CASE WHEN julianday(report_issue_date) > julianday(report_due_date) THEN 1 ELSE 0 END) AS overdue,
       COUNT(*) AS total
       FROM project
      WHERE report_issue_date IS NOT NULL
        AND report_due_date IS NOT NULL`
  )
  return { overdue: Number(row?.overdue ?? 0), total: Number(row?.total ?? 0) }
}

/** 在办项目里，报告应出日期已过但还没出具的份数 */
export function countReportOverdueOpen(today: string): number {
  const row = getDb().get<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM project
      WHERE report_due_date IS NOT NULL
        AND report_due_date < ?
        AND report_issue_date IS NULL
        AND status NOT IN ('closed', 'cancelled')`,
    today
  )
  return Number(row?.c ?? 0)
}
