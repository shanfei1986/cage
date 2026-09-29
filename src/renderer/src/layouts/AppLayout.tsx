import { useMemo, useState } from 'react'
import { Layout, Menu, Typography } from 'antd'
import {
  AppstoreOutlined,
  BarChartOutlined,
  FolderOpenOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

const MENU_ITEMS = [
  { key: '/dashboard', icon: <AppstoreOutlined />, label: '工作台' },
  { key: '/projects', icon: <FolderOpenOutlined />, label: '项目列表' },
  { key: '/stats', icon: <BarChartOutlined />, label: '统计报表' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' }
]

export default function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  // 详情页 /projects/xxx 也要让"项目列表"保持高亮
  const selectedKey = useMemo(() => {
    const path = location.pathname
    const hit = MENU_ITEMS.map((m) => m.key).find((k) => path === k || path.startsWith(`${k}/`))
    return hit ?? '/dashboard'
  }, [location.pathname])

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        width={200}
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: collapsed ? 14 : 16,
            color: '#1677ff',
            borderBottom: '1px solid #f0f0f0'
          }}
        >
          {collapsed ? '检测' : '检测项目管理系统'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            height: 56,
            lineHeight: '56px',
            borderBottom: '1px solid #f0f0f0'
          }}
        >
          <Typography.Text strong style={{ fontSize: 15 }}>
            检测项目全流程记录
          </Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            接单 → 联系委托方 → 确定检测日期 → 进场检测 → 整理记录 → 出具报告
          </Typography.Text>
        </Header>

        <Content className="page-container" style={{ padding: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
