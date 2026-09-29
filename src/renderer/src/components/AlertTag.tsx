import { Tag, Tooltip } from 'antd'
import type { AlertLevel } from '@shared/types'
import type { AlertHit } from '@shared/alerts'
import { ALERT_LEVEL_LABEL } from '@shared/alerts'

/**
 * 待办紧急度的统一视觉表达。
 * 三级配色固定成一处，工作台、列表页、详情页都从这里取，避免三处各写一套颜色。
 */
export const ALERT_LEVEL_COLOR: Record<AlertLevel, string> = {
  overdue: 'red',
  today: 'orange',
  soon: 'blue'
}

export const ALERT_LEVEL_HEX: Record<AlertLevel, string> = {
  overdue: '#ff4d4f',
  today: '#faad14',
  soon: '#1677ff'
}

export function AlertLevelTag({ level }: { level: AlertLevel }): React.JSX.Element {
  return <Tag color={ALERT_LEVEL_COLOR[level]}>{ALERT_LEVEL_LABEL[level]}</Tag>
}

/**
 * 展示一个项目命中的全部原因。
 * 列表页空间紧张，默认只显示前 max 条，其余折叠进 Tooltip ——
 * 比直接截断更好：用户能看出"还有别的原因"，也随时能看到全部。
 */
export function AlertHitsTags({
  hits,
  max = 2,
  size = 'default'
}: {
  hits: AlertHit[]
  max?: number
  size?: 'default' | 'small'
}): React.JSX.Element {
  if (hits.length === 0) return <></>

  const style = size === 'small' ? { fontSize: 11, lineHeight: '16px', margin: 0 } : undefined
  const shown = hits.slice(0, max)
  const rest = hits.slice(max)

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {shown.map((h, i) => (
        <Tag key={`${h.rule}-${i}`} color={ALERT_LEVEL_COLOR[h.level]} style={style}>
          {h.text}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tooltip
          title={
            <div>
              {rest.map((h, i) => (
                <div key={`${h.rule}-r${i}`}>
                  {ALERT_LEVEL_LABEL[h.level]}：{h.text}
                </div>
              ))}
            </div>
          }
        >
          <Tag style={style}>+{rest.length}</Tag>
        </Tooltip>
      )}
    </span>
  )
}
