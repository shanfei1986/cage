import type { AlertCandidate } from '@shared/types'
import { getDb } from '../connection'

/**
 * 待办预警的数据来源。
 *
 * 只取评估需要的字段、只取非终态项目 —— 终态项目在 evaluateAlerts 里也被挡掉，
 * 这里先在 SQL 层滤一遍，省得把整张 project 表搬进内存。
 *
 * 为什么不做成复杂的 SQL 聚合：判定规则里有"多条规则互斥/兜底"这类逻辑，
 * 用 SQL 表达会变成一大坨 CASE WHEN，既难读也难测。项目量级（几百到几千）
 * 下，取回候选行在内存里算完全够用，而且规则可以直接单测。
 */
export function listAlertCandidates(): AlertCandidate[] {
  return getDb().all<AlertCandidate>(
    `SELECT id, task_no, name, status, test_status,
            receive_date, plan_test_date, report_due_date, report_issue_date, updated_at
       FROM project
      WHERE status NOT IN ('closed', 'cancelled')`
  )
}
