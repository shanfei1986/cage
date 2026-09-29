import { Card, Empty, List, Typography } from 'antd'

const PLANNED = [
  '按月项目量趋势（折线图）：接单量、完成量随时间的变化',
  '按业务类型分布（饼图）：安全性 / 可靠性 / 危险性 / 抗震 / 施工前周边 …',
  '按当前阶段分布（柱状图）：一眼看出积压在哪一步',
  '按检测人员统计：每人手上在办与已完成项目数',
  '按委托方统计：合作频次与项目量排名',
  '报告超期率与平均周期：从接单到出报告平均用了多少天'
]

export default function Stats(): React.JSX.Element {
  return (
    <Card title="统计报表" size="small">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="统计报表与导出将在下一阶段实现"
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>
        计划包含的统计维度
      </Typography.Title>
      <List
        size="small"
        bordered
        dataSource={PLANNED}
        renderItem={(t) => <List.Item>{t}</List.Item>}
      />
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        届时会同时提供 Excel（.xlsx）与 CSV 导出，用于科室汇报。
      </Typography.Text>
    </Card>
  )
}
