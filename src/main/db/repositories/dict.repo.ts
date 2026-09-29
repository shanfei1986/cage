import type { DictItem } from '@shared/types'
import { getDb } from '../connection'

/** 按类型列出字典项 */
export function listDict(type: string, onlyEnabled = true): DictItem[] {
  const sql = onlyEnabled
    ? 'SELECT * FROM dict WHERE type = ? AND enabled = 1 ORDER BY sort, id'
    : 'SELECT * FROM dict WHERE type = ? ORDER BY sort, id'
  return getDb().all<DictItem>(sql, type)
}

/** 字典类型的中文名（界面上用于分组标题） */
export const DICT_TYPE_LABEL: Record<string, string> = {
  project_type: '业务类型',
  test_category: '检测类别',
  source: '任务来源'
}

/** 一次取回多个类型，减少 IPC 往返 */
export function getDictBundle(types: string[]): Record<string, DictItem[]> {
  const out: Record<string, DictItem[]> = {}
  for (const t of types) out[t] = listDict(t)
  return out
}

/** 取某个字典项的显示名；查不到就原样返回 code，保证界面不出现空白 */
export function dictLabel(type: string, code: string | null | undefined): string {
  if (!code) return ''
  const row = getDb().get<{ label: string }>(
    'SELECT label FROM dict WHERE type = ? AND code = ? LIMIT 1',
    type,
    code
  )
  return row?.label ?? code
}
