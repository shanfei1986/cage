/**
 * 任务单号规则（与用户确认，唯一权威定义）
 *
 * 格式：2 个小写字母 + "-" + 5 位数字，例如 lz-00007
 * 录入方式：完全手工输入，软件不自动生成流水号。
 * 软件只做三项校验：格式、唯一性、前缀一致性（前缀不一致只软提醒不硬拦）。
 */

export const TASK_NO_PATTERN = /^[a-z]{2}-\d{5}$/

/** 默认前缀（全院统一）。实际取值以设置表 org.task_prefix 为准，这里只是兜底。 */
export const DEFAULT_TASK_PREFIX = 'lz'

/**
 * 把用户输入规范化成标准形态，尽量"猜对"，减少手工录入出错：
 *  - 去空格、转小写
 *  - 常见的全角横线 / 下划线统一成半角 "-"
 *  - 忘记打连字符时（如 lz00007）自动补上
 *  - 多个连续连字符合并成一个
 */
export function normalizeTaskNo(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, '')
  s = s.replace(/[－—–_]/g, '-')
  if (!s.includes('-')) {
    const m = s.match(/^([a-z]{2})(.+)$/)
    if (m) s = `${m[1]}-${m[2]}`
  }
  s = s.replace(/-+/g, '-')
  return s
}

export interface TaskNoCheckResult {
  ok: boolean
  /** 规范化之后的字符串，写库时用这个 */
  value: string
  /** 给用户看的错误原因 */
  error?: string
  /** 前缀与设置里的统一前缀不一致时的提醒（软提醒，不拦截） */
  prefixWarning?: string
}

/** 只做格式校验（唯一性需要查库，在仓储层另做） */
export function checkTaskNoFormat(
  raw: string | null | undefined,
  expectedPrefix: string = DEFAULT_TASK_PREFIX
): TaskNoCheckResult {
  const value = normalizeTaskNo(raw)

  if (!value) {
    return { ok: false, value, error: '请填写任务单号' }
  }
  if (!TASK_NO_PATTERN.test(value)) {
    return {
      ok: false,
      value,
      error: '任务单号格式应为「2 个小写字母 + 5 位数字」，例如 lz-00007'
    }
  }

  const prefix = value.slice(0, 2)
  const want = String(expectedPrefix || DEFAULT_TASK_PREFIX).trim().toLowerCase()
  if (want && prefix !== want) {
    return {
      ok: true,
      value,
      prefixWarning: `前缀「${prefix}」与设置的统一前缀「${want}」不一致，请确认是否填错`
    }
  }
  return { ok: true, value }
}
