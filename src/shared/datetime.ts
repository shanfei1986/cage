/**
 * 日期时间工具（两端共用）。
 * 数据库里统一存 ISO 文本：日期存 'YYYY-MM-DD'，时间点存 'YYYY-MM-DD HH:mm:ss'。
 * SQLite 没有日期类型，文本可以直接比较，也可读、无时区歧义。
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 当前本地日期 'YYYY-MM-DD' */
export function todayLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 当前本地时间 'YYYY-MM-DD HH:mm:ss' */
export function nowLocal(d: Date = new Date()): string {
  return `${todayLocal(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 把 'YYYY-MM-DD' 或完整时间戳解析成 Date（本地时区） */
export function parseLocalDate(text: string | null | undefined): Date | null {
  if (!text) return null
  const m = String(text).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) return null
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0)
  )
}

/** 只取日期部分 */
export function toDateText(text: string | null | undefined): string | null {
  if (!text) return null
  const m = String(text).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** 两个日期之间相差的天数（b - a），用于算超期天数 */
export function diffDays(aText: string | null | undefined, bText: string | null | undefined): number | null {
  const a = parseLocalDate(toDateText(aText))
  const b = parseLocalDate(toDateText(bText))
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** 在某个日期上加减天数，返回 'YYYY-MM-DD' */
export function addDays(dateText: string, days: number): string {
  const d = parseLocalDate(toDateText(dateText)) ?? new Date()
  d.setDate(d.getDate() + days)
  return todayLocal(d)
}
