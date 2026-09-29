/**
 * 待办提醒与超期预警 —— 规则判定（纯函数，无副作用）。
 *
 * 为什么单独放一层纯函数：
 * 1. 主进程只负责"取数据 + 读阈值"，判定逻辑全在这里，能被自检脚本直接调用；
 * 2. 规则最容易写错的是边界（当天算不算超期、日期为空怎么办），把边界集中在一处，
 *    配合 scripts/db-selftest.ts 里的逐条断言，改规则时不会悄悄改坏旧行为。
 *
 * 天数一律按"自然日"算（复用 diffDays，它只取日期部分，忽略时分秒）。
 */

import type { AlertCandidate, AlertLevel, ProjectStatus, TestStatus } from './types'
import { diffDays } from './datetime'

/** 预警规则标识 */
export type AlertRule =
  | 'receive_contact' // 接单后迟迟未联系委托方
  | 'test_upcoming' // 约定检测日期临近 / 已过
  | 'report_due' // 报告应出日期临近 / 已超期
  | 'stale' // 项目停滞（兜底规则）
  | 'partial_followup' // 部分完成后再没进场

/** 判定所需的项目字段（AlertCandidate 去掉标识与展示字段） */
export type AlertEvalInput = Omit<AlertCandidate, 'id' | 'task_no' | 'name'>

/** 阈值（天）。与本项目 SEED_V1_SETTINGS 里的 alert.* 一一对应 */
export interface AlertThresholds {
  receive_contact_days: number
  test_upcoming_days: number
  report_due_warn_days: number
  stale_days: number
  partial_followup_days: number
}

/** 单条命中原因 */
export interface AlertHit {
  rule: AlertRule
  level: AlertLevel
  /** 算天数用的基准日期（界面上可以顺带展示） */
  base_date: string
  /** 距今天数（取绝对值，用于同级排序时比严重程度） */
  days: number
  /** 给人看的一句话 */
  text: string
}

/** 一个项目一条待办（可含多条原因） */
export interface ProjectAlert {
  project_id: string
  task_no: string
  name: string
  /** 该项目最严重的一级，用于行标颜色与排序 */
  level: AlertLevel
  hits: AlertHit[]
}

/** 规则中文名，用于界面 Tooltip / 筛选下拉 */
export const ALERT_RULE_LABEL: Record<AlertRule, string> = {
  receive_contact: '接单未联系',
  test_upcoming: '进场日期',
  report_due: '报告应出',
  stale: '项目停滞',
  partial_followup: '部分完成待跟进'
}

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  overdue: '已超期',
  today: '今天到期',
  soon: '临近'
}

/** 紧急度权重：数字越大越紧急 */
export const ALERT_LEVEL_RANK: Record<AlertLevel, number> = {
  overdue: 3,
  today: 2,
  soon: 1
}

/** 从多条命中里取最严重的一级 */
export function highestLevel(hits: AlertHit[]): AlertLevel | null {
  let best: AlertLevel | null = null
  for (const h of hits) {
    if (!best || ALERT_LEVEL_RANK[h.level] > ALERT_LEVEL_RANK[best]) best = h.level
  }
  return best
}

/** 命中里最大的距今天数，用于同级之间排序 */
export function maxHitDays(hits: AlertHit[]): number {
  return hits.reduce((m, h) => (h.days > m ? h.days : m), 0)
}

/**
 * 待办列表排序：越紧急越靠前。
 * 先按紧急度，再按"拖得更久"的靠前，最后用项目 id 兜底保证顺序稳定
 * （否则同一份数据两次渲染可能顺序不同，看起来像在闪）。
 */
export function compareAlerts(a: ProjectAlert, b: ProjectAlert): number {
  const byLevel = ALERT_LEVEL_RANK[b.level] - ALERT_LEVEL_RANK[a.level]
  if (byLevel !== 0) return byLevel
  const byDays = maxHitDays(b.hits) - maxHitDays(a.hits)
  if (byDays !== 0) return byDays
  return a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0
}

const TERMINAL: ProjectStatus[] = ['closed', 'cancelled']

/**
 * 判定一个项目当前命中的所有待办。
 *
 * 规则口径（都在自检里有对应断言）：
 * - 终态（已归档 / 已取消）：全部不报 —— 事都办完了还提醒就是噪音。
 * - 已暂缓：全部不报 —— 暂缓是主动挂起。想改成"暂缓也要提醒"，删掉下面
 *   `status === 'paused'` 那一行即可。
 * - 恰好第 N 天：算「今天到期」，不算超期；第 N+1 天才算超期。
 * - 事件日期（接单日 / 约定进场日 / 报告应出日）为空的规则直接跳过。
 * - 「项目停滞」是兜底规则：只有该项目没命中其他规则时才单独报，
 *   避免"接单 10 天没联系"同时刷出"接单未联系"和"项目停滞"两条重复标签。
 */
export function evaluateAlerts(
  p: AlertEvalInput,
  t: AlertThresholds,
  today: string
): AlertHit[] {
  if (TERMINAL.includes(p.status)) return []
  if (p.status === 'paused') return []

  const hits: AlertHit[] = []
  const push = (
    rule: AlertRule,
    level: AlertLevel,
    base_date: string,
    days: number,
    text: string
  ): void => {
    hits.push({ rule, level, base_date, days, text })
  }

  // ① 接单后未联系委托方：基准是接单日，天数越大越拖
  if (p.status === 'received' && p.receive_date) {
    const d = diffDays(p.receive_date, today) // 正数 = 已过 d 天
    if (d !== null) {
      if (d > t.receive_contact_days) {
        push('receive_contact', 'overdue', p.receive_date, d, `接单 ${d} 天未联系委托方`)
      } else if (d === t.receive_contact_days) {
        push('receive_contact', 'today', p.receive_date, d, `今天到期：接单已 ${d} 天未联系委托方`)
      }
    }
  }

  // ② 部分完成待跟进：基准是最后更新时间（= 上次进场或改动的日子）
  if (p.test_status === 'partial') {
    const d = diffDays(p.updated_at, today)
    if (d !== null) {
      if (d > t.partial_followup_days) {
        push('partial_followup', 'overdue', p.updated_at, d, `部分完成 ${d} 天未再进场`)
      } else if (d === t.partial_followup_days) {
        push(
          'partial_followup',
          'today',
          p.updated_at,
          d,
          `今天到期：部分完成已 ${d} 天未再进场`
        )
      }
    }
  }

  // ③ 约定检测日期临近 / 已过：基准是约定日期，注意方向与上面相反
  if (p.status === 'scheduled' && p.plan_test_date) {
    const d = diffDays(today, p.plan_test_date) // 正数 = 还有 d 天
    if (d !== null) {
      if (d < 0) {
        push('test_upcoming', 'overdue', p.plan_test_date, -d, `约定检测日期已过 ${-d} 天`)
      } else if (d === 0) {
        push('test_upcoming', 'today', p.plan_test_date, 0, '今天应进场检测')
      } else if (d <= t.test_upcoming_days) {
        push('test_upcoming', 'soon', p.plan_test_date, d, `${d} 天后进场检测`)
      }
    }
  }

  // ④ 报告应出临近 / 已超期
  //    已经出过报告（状态到位或已有出具日期）就不再提醒
  const reportDone = p.status === 'report_issued' || !!p.report_issue_date
  if (!reportDone && p.report_due_date) {
    const d = diffDays(today, p.report_due_date)
    if (d !== null) {
      if (d < 0) {
        push('report_due', 'overdue', p.report_due_date, -d, `报告已超期 ${-d} 天`)
      } else if (d === 0) {
        push('report_due', 'today', p.report_due_date, 0, '今天应出报告')
      } else if (d <= t.report_due_warn_days) {
        push('report_due', 'soon', p.report_due_date, d, `${d} 天后该出报告`)
      }
    }
  }

  // ⑤ 兜底：上述都没命中，但项目整体很久没动过
  if (hits.length === 0) {
    const d = diffDays(p.updated_at, today)
    if (d !== null) {
      if (d > t.stale_days) {
        push('stale', 'overdue', p.updated_at, d, `已停滞 ${d} 天无进展`)
      } else if (d === t.stale_days) {
        push('stale', 'today', p.updated_at, d, `今天到期：已停滞 ${d} 天无进展`)
      }
    }
  }

  return hits
}

/** 判定并组装成"一个项目一条"的待办项；无命中返回 null */
export function buildProjectAlert(
  p: Pick<AlertCandidate, 'id' | 'task_no' | 'name'> & AlertEvalInput,
  t: AlertThresholds,
  today: string
): ProjectAlert | null {
  const hits = evaluateAlerts(p, t, today)
  if (hits.length === 0) return null
  return {
    project_id: p.id,
    task_no: p.task_no,
    name: p.name,
    level: highestLevel(hits) as AlertLevel,
    hits
  }
}

/** 供界面显示：本项目最该关注的日期（取最严重那条命中的基准日期） */
export function primaryAlertDate(alert: ProjectAlert): string {
  const sorted = [...alert.hits].sort((a, b) => {
    const byLevel = ALERT_LEVEL_RANK[b.level] - ALERT_LEVEL_RANK[a.level]
    return byLevel !== 0 ? byLevel : b.days - a.days
  })
  return sorted[0]?.base_date ?? ''
}

/** 统计各紧急度的数量 */
export function countByLevel(alerts: ProjectAlert[]): {
  overdue: number
  today: number
  soon: number
  total: number
} {
  const c = { overdue: 0, today: 0, soon: 0, total: alerts.length }
  for (const a of alerts) c[a.level]++
  return c
}

/** 供自检与测试用：构造一条空的判定输入 */
export const EMPTY_ALERT_INPUT: AlertEvalInput = {
  status: 'received',
  test_status: 'none' as TestStatus,
  receive_date: null,
  plan_test_date: null,
  report_due_date: null,
  report_issue_date: null,
  updated_at: '2026-01-01 00:00:00'
}
