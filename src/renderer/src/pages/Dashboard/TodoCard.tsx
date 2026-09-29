import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, List, Segmented, Space, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { AlertCounts, AlertLevel } from '@shared/types'
import { ALERT_LEVEL_LABEL, primaryAlertDate, type ProjectAlert } from '@shared/alerts'
import api from '../../api'
import { AlertHitsTags } from '../../components/AlertTag'

/**
 * 工作台的「今日待办」。
 *
 * 设计要点：
 * - 一个项目一行（不是一条规则一行），行内用 Tag 列出全部原因，避免同一项目刷屏；
 * - 点整行直接进项目详情，不用先点"查看"再找；
 * - 顶部按紧急度分档并显示数量，用户能先看"已超期"这一档。
 */

type Filter = AlertLevel | 'all'

const FILTER_OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'overdue', label: ALERT_LEVEL_LABEL.overdue },
  { value: 'today', label: ALERT_LEVEL_LABEL.today },
  { value: 'soon', label: ALERT_LEVEL_LABEL.soon }
]

export default function TodoCard(): React.JSX.Element {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<ProjectAlert[]>([])
  const [counts, setCounts] = useState<AlertCounts>({ overdue: 0, today: 0, soon: 0, total: 0 })
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, c] = await Promise.all([api.alert.list(), api.alert.counts()])
      setAlerts(list)
      setCounts(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(
    () => (filter === 'all' ? alerts : alerts.filter((a) => a.level === filter)),
    [alerts, filter]
  )

  return (
    <Card
      size="small"
      className="todo-card"
      title={
        <Space size={8}>
          <span>今日待办</span>
          {counts.total > 0 && <Tag color="red">{counts.total}</Tag>}
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message="读取待办失败" description={error} />}

      {counts.total > 0 && (
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={FILTER_OPTIONS.map((o) => ({
            value: o.value,
            label:
              o.value === 'all'
                ? `${o.label}（${counts.total}）`
                : `${o.label}（${counts[o.value as AlertLevel]}）`
          }))}
          style={{ marginBottom: 12 }}
        />
      )}

      {!error && shown.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={counts.total === 0 ? '今天没有待办事项' : '这一档没有待办'}
        />
      ) : (
        <List
          size="small"
          loading={loading}
          dataSource={shown}
          renderItem={(a) => (
            <List.Item
              style={{ cursor: 'pointer', alignItems: 'flex-start' }}
              onClick={() => navigate(`/projects/${a.project_id}`)}
              actions={[
                <Typography.Text key="d" type="secondary" style={{ fontSize: 12 }}>
                  {primaryAlertDate(a)}
                </Typography.Text>,
                <a key="v" style={{ fontSize: 12 }}>
                  查看
                </a>
              ]}
            >
              <Space direction="vertical" size={4} style={{ display: 'flex' }}>
                <Space size={8} wrap>
                  <Tag color="blue">{a.task_no}</Tag>
                  <span>{a.name}</span>
                </Space>
                <AlertHitsTags hits={a.hits} max={3} size="small" />
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}
