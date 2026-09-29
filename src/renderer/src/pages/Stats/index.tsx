import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Col, Empty, Row, Segmented, Space, Statistic, Tag, Typography } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import type { StatsOverview } from '@shared/types'
import { STATUS_CHART_ORDER, formatAvgDays, formatRate, statusLabelOf } from '@shared/stats'
import { STATUS_COLOR } from '@shared/projectStatus'
import api from '../../api'

/** 时间范围选项。24 个月够看出两年内的起伏，再长折线就没法看了 */
const RANGE_OPTIONS = [
  { label: '近 6 个月', value: 6 },
  { label: '近 12 个月', value: 12 },
  { label: '近 24 个月', value: 24 }
]

/** 饼图配色，跟 AntD 的色板保持一致 */
const PIE_COLORS = ['#1677ff', '#52c41a', '#faad14', '#13c2c2', '#722ed1', '#eb2f96', '#fa8c16', '#8c8c8c']

const AXIS_LABEL = { color: '#595959', fontSize: 12 }
const GRID = { left: 48, right: 24, top: 32, bottom: 40 }

export default function Stats(): React.JSX.Element {
  const { message } = App.useApp()
  const [months, setMonths] = useState(12)
  const [data, setData] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.stats.overview(months))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [months])

  useEffect(() => {
    void load()
  }, [load])

  async function onExport(): Promise<void> {
    setExporting(true)
    try {
      const res = await api.project.exportExcel({})
      if (!res.ok) {
        if (res.message !== '已取消导出') message.warning(res.message)
        return
      }
      message.success(res.message)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  // ── 图表配置。放在 useMemo 里：这些对象每次渲染都重建的话，ECharts 会反复重绘 ──

  const trendOption = useMemo(() => {
    const trend = data?.trend ?? []
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['接单量', '报告出具量'], top: 0, textStyle: AXIS_LABEL },
      grid: GRID,
      xAxis: {
        type: 'category',
        data: trend.map((t) => t.ym),
        axisLabel: { ...AXIS_LABEL, rotate: trend.length > 12 ? 40 : 0 }
      },
      yAxis: { type: 'value', minInterval: 1, axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f0f0f0' } } },
      series: [
        {
          name: '接单量',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: trend.map((t) => t.received),
          itemStyle: { color: '#1677ff' },
          areaStyle: { color: 'rgba(22,119,255,0.10)' }
        },
        {
          name: '报告出具量',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: trend.map((t) => t.issued),
          itemStyle: { color: '#52c41a' },
          areaStyle: { color: 'rgba(82,196,26,0.10)' }
        }
      ]
    }
  }, [data])

  const pieOption = useMemo(() => {
    const rows = data?.byProjectType ?? []
    return {
      tooltip: { trigger: 'item', formatter: '{b}：{c} 个（{d}%）' },
      legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', textStyle: AXIS_LABEL },
      color: PIE_COLORS,
      series: [
        {
          name: '业务类型',
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['40%', '52%'],
          avoidLabelOverlap: true,
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold', color: '#262626' } },
          data: rows.map((r) => ({ name: r.label, value: r.count }))
        }
      ]
    }
  }, [data])

  const statusOption = useMemo(() => {
    const counts = new Map((data?.byStatus ?? []).map((r) => [r.status, r.count]))
    // 固定顺序而不是按数量排：同一张图在不同月份下"第 3 根柱"始终是同一个阶段，
    // 时间范围一切换柱子就换位置的话，根本没法比较
    const rows = STATUS_CHART_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      status: s,
      label: statusLabelOf(s),
      count: counts.get(s) ?? 0
    }))
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: GRID,
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.label),
        axisLabel: { ...AXIS_LABEL, rotate: 30 }
      },
      yAxis: { type: 'value', minInterval: 1, axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f0f0f0' } } },
      series: [
        {
          name: '项目数',
          type: 'bar',
          barMaxWidth: 40,
          data: rows.map((r) => ({
            value: r.count,
            itemStyle: { color: barColor(r.status) }
          })),
          label: { show: true, position: 'top', color: '#595959', fontSize: 12 }
        }
      ]
    }
  }, [data])

  const cycle = data?.cycle
  const trendTotal = (data?.trend ?? []).reduce((a, b) => a + b.received, 0)

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="读取统计数据失败" description={error} />}

      <Card
        size="small"
        title="统计报表"
        extra={
          <Space size={8}>
            <Segmented
              size="small"
              options={RANGE_OPTIONS}
              value={months}
              onChange={(v) => setMonths(Number(v))}
            />
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={() => void onExport()}
            >
              导出项目台账
            </Button>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Statistic
              title={`近 ${months} 个月接单量`}
              value={trendTotal}
              loading={loading}
              suffix="个"
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="平均接单 → 进场"
              value={formatAvgDays(cycle?.avgReceiveToTest)}
              loading={loading}
              valueStyle={{ fontSize: 22 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="平均接单 → 出报告"
              value={formatAvgDays(cycle?.avgReceiveToReport)}
              loading={loading}
              valueStyle={{ fontSize: 22 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="报告超期率"
              value={formatRate(cycle?.reportOverdueRate)}
              loading={loading}
              valueStyle={{
                fontSize: 22,
                color:
                  cycle?.reportOverdueRate === null || cycle?.reportOverdueRate === undefined
                    ? undefined
                    : cycle.reportOverdueRate > 0.2
                      ? '#cf1322'
                      : '#3f8600'
              }}
              suffix={
                cycle && cycle.reportIssuedWithDue > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {cycle.reportOverdueIssued}/{cycle.reportIssuedWithDue} 份
                  </Typography.Text>
                ) : null
              }
            />
          </Col>
        </Row>

        {cycle && cycle.reportOverdueOpen > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={`当前有 ${cycle.reportOverdueOpen} 个在办项目的报告应出日期已过、尚未出具，建议尽快处理。`}
          />
        )}
      </Card>

      <Card
        size="small"
        title={`按月项目量趋势（近 ${months} 个月）`}
        loading={loading}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            接单量按接单日期、报告出具量按实际出具日期归月；空档月份按 0 处理
          </Typography.Text>
        }
      >
        {data && trendTotal === 0 && (data?.trend ?? []).every((t) => t.issued === 0) ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这段时间还没有数据" />
        ) : (
          <ReactECharts option={trendOption} style={{ height: 300 }} notMerge />
        )}
      </Card>

      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="业务类型分布" loading={loading}>
            {(data?.byProjectType ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            ) : (
              <ReactECharts option={pieOption} style={{ height: 300 }} notMerge />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="当前阶段分布" loading={loading}>
            {(data?.byStatus ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
            ) : (
              <ReactECharts option={statusOption} style={{ height: 300 }} notMerge />
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="统计口径说明">
        <Typography.Paragraph style={{ marginBottom: 8, fontSize: 13 }}>
          <Tag>时间趋势 / 业务类型分布</Tag>
          已取消的项目不计入 —— 取消的单子不算实际工作量。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8, fontSize: 13 }}>
          <Tag>当前阶段分布</Tag>
          不做过滤，已归档、已暂缓、已取消都会显示，便于看出项目最终去向。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
          <Tag>平均周期 / 超期率</Tag>
          只在填了对应日期的项目上取平均，没有样本时显示「暂无数据」而不是 0 天；
          手误把日期填成未来的记录会被排除，避免把平均值带偏。
        </Typography.Paragraph>
      </Card>
    </Space>
  )
}

/** 柱状图颜色跟状态标签保持一致，看着不跳 */
function barColor(status: string): string {
  const map: Record<string, string> = {
    default: '#bfbfbf',
    blue: '#1677ff',
    cyan: '#13c2c2',
    processing: '#1677ff',
    geekblue: '#2f54eb',
    orange: '#fa8c16',
    green: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f'
  }
  return map[STATUS_COLOR[status as keyof typeof STATUS_COLOR]] ?? '#8c8c8c'
}
