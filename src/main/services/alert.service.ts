import type { AlertCounts, AlertLevel } from '@shared/types'
import {
  buildProjectAlert,
  compareAlerts,
  countByLevel,
  type AlertThresholds,
  type ProjectAlert
} from '@shared/alerts'
import { todayLocal } from '@shared/datetime'
import { listAlertCandidates } from '../db/repositories/alert.repo'
import { getNumberSetting } from '../db/repositories/setting.repo'

/**
 * 待办提醒与超期预警。
 *
 * 分工：SQL 只负责"把非终态项目捞出来"，判定全交给 @shared/alerts 里的纯函数。
 * 阈值从 setting 表实时读 —— 用户在设置页改完立刻生效，不用重启软件。
 *
 * fallback 值刻意与 SEED_V1_SETTINGS 保持一致：这样"从没设置过"和"被清空过"
 * 走的是同一套默认值，不会出现两种行为。
 */

export function getThresholds(): AlertThresholds {
  return {
    receive_contact_days: getNumberSetting('alert.receive_contact_days', 3),
    test_upcoming_days: getNumberSetting('alert.test_upcoming_days', 2),
    report_due_warn_days: getNumberSetting('alert.report_due_warn_days', 3),
    stale_days: getNumberSetting('alert.stale_days', 7),
    partial_followup_days: getNumberSetting('alert.partial_followup_days', 5)
  }
}

/** 全部待办，按紧急度排好序 */
export function getAlerts(): ProjectAlert[] {
  const thresholds = getThresholds()
  const today = todayLocal()
  const out: ProjectAlert[] = []
  for (const c of listAlertCandidates()) {
    const alert = buildProjectAlert(c, thresholds, today)
    if (alert) out.push(alert)
  }
  return out.sort(compareAlerts)
}

export function getAlertCounts(): AlertCounts {
  return countByLevel(getAlerts())
}

/**
 * 按紧急度取出项目 id 集合，供列表页"只看待办"下推到 SQL。
 * level 为 'all' 时返回 null（不限制）。
 */
export function getAlertProjectIds(level: AlertLevel | 'all'): string[] | null {
  if (level === 'all') return null
  return getAlerts()
    .filter((a) => a.level === level)
    .map((a) => a.project_id)
}
