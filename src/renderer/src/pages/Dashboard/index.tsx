import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Empty, List, Row, Space, Statistic, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ProjectLog, ProjectStatus } from '@shared/types'
import { STATUS_COLOR, STATUS_LABEL, TERMINAL_STATUS } from '@shared/projectStatus'
import api from '../../api'

/** 各个阶段单独成卡片，一眼看出积压在哪一步 */
const STAGE_CARDS: ProjectStatus[] = [
  'received',
  'contacted',
  'scheduled',
  'testing',
  'organizing',
  'reporting',
  'report_issued'
]

export default function Dashboard(): React.JSX.Element {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [logs, setLogs] = useState<Array<ProjectLog & { project_name?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [c, l] = await Promise.all([api.project.countByStatus(), api.project.recentLogs(15)])
      setCounts(c)
      setLogs(l)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const closedCount = TERMINAL_STATUS.reduce((a, s) => a + (counts[s] ?? 0), 0)
  const active = total - closedCount

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="读取数据失败" description={error} />}

      <Card
        size="small"
        title="项目概览"
        extra={
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Statistic title="全部项目" value={total} loading={loading} />
          </Col>
          <Col span={6}>
            <Statistic
              title="在办项目"
              value={active}
              loading={loading}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col span={6}>
            <Statistic title="已归档 / 已取消" value={closedCount} loading={loading} />
          </Col>
          <Col span={6}>
            <Statistic
              title="已暂缓"
              value={counts['paused'] ?? 0}
              loading={loading}
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
        </Row>
      </Card>

      <Card size="small" title="各阶段在办数量">
        <Row gutter={[16, 16]}>
          {STAGE_CARDS.map((s) => (
            <Col span={6} key={s}>
              <Card
                size="small"
                hoverable
                onClick={() => navigate(`/projects?status=${s}`)}
                style={{ borderLeft: `3px solid ${statusBarColor(s)}` }}
              >
                <Statistic
                  title={<Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>}
                  value={counts[s] ?? 0}
                  loading={loading}
                />
              </Card>
            </Col>
          ))}
        </Row>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          待办提醒与超期预警（今日应进场、报告超期、项目停滞等）将在下一阶段接入。
        </Typography.Text>
      </Card>

      <Card
        title="最近动态"
        size="small"
        loading={loading}
        extra={
          <a onClick={() => navigate('/projects')} style={{ fontSize: 13 }}>
            全部项目
          </a>
        }
      >
        {logs.length === 0 ? (
          <Empty
            description="还没有任何操作记录，去「项目列表」新建一个项目试试"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <List
            size="small"
            dataSource={logs}
            renderItem={(it) => (
              <List.Item
                actions={[
                  <Typography.Text key="t" type="secondary" style={{ fontSize: 12 }}>
                    {it.occurred_at}
                  </Typography.Text>,
                  <a key="v" style={{ fontSize: 12 }} onClick={() => navigate(`/projects/${it.project_id}`)}>
                    查看
                  </a>
                ]}
              >
                <Space size={8}>
                  <Tag>{it.project_name ?? '未知项目'}</Tag>
                  <span>{it.content ?? it.action}</span>
                  {it.operator && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      by {it.operator}
                    </Typography.Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  )
}

/** 卡片左侧的色条，用状态色 */
function statusBarColor(s: ProjectStatus): string {
  const map: Record<string, string> = {
    default: '#d9d9d9',
    blue: '#1677ff',
    cyan: '#13c2c2',
    processing: '#1677ff',
    geekblue: '#2f54eb',
    orange: '#fa8c16',
    green: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f'
  }
  return map[STATUS_COLOR[s]] ?? '#d9d9d9'
}
