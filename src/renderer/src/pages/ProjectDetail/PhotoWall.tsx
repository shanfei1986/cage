import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, Image, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Attachment } from '@shared/types'
import { buildMediaUrl, formatBytes } from '@shared/attachment'
import api from '../../api'

/**
 * 项目详情页的现场照片墙。
 *
 * 性能上的考虑（照片是最容易把界面拖垮的功能）：
 * - 缩略图固定展示盒 + object-fit: cover + loading="lazy"，浏览器只解码可视区域；
 * - 单项目默认只渲染最近 24 张，超出的点"加载更多" —— 避免一次解压上百张 12MP 手机照；
 * - 大图预览复用同一个协议 URL，交给 antd 的 PreviewGroup（自带缩放、旋转、左右切换）。
 *
 * EXIF 方向不用特殊处理：走自定义协议 + <img> 时，浏览器会按 image-orientation
 * 的初始值 from-image 自动纠正，手机竖拍的照片不会横躺。
 */

const PAGE_STEP = 24

export default function PhotoWall({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp()
  const [items, setItems] = useState<Attachment[]>([])
  const [visible, setVisible] = useState(PAGE_STEP)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.attachment.list(projectId)
      setItems(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    setVisible(PAGE_STEP) // 换项目时重置分页，否则会带着上一个项目的"已展开"状态
    void load()
  }, [load])

  async function onAdd(): Promise<void> {
    setBusy(true)
    try {
      const res = await api.attachment.add(projectId)
      if (!res.ok) {
        // 用户主动取消不算错误，不要弹红色提示吓人
        if (res.message && res.message !== '已取消') message.warning(res.message)
        return
      }
      if (res.message) message.success(res.message)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(id: string): Promise<void> {
    try {
      const res = await api.attachment.remove(id)
      if (!res.ok) {
        message.error(res.message ?? '删除失败')
        return
      }
      message.success('已删除')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const shown = useMemo(() => items.slice(0, visible), [items, visible])
  const totalBytes = useMemo(() => items.reduce((a, b) => a + (b.size_bytes || 0), 0), [items])

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span>现场照片</span>
          {items.length > 0 && <Tag color="blue">{items.length}</Tag>}
          {items.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              合计 {formatBytes(totalBytes)}
            </Typography.Text>
          )}
        </Space>
      }
      extra={
        <Space size={8}>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            loading={busy}
            onClick={() => void onAdd()}
          >
            添加照片
          </Button>
        </Space>
      }
    >
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={loading ? '正在读取…' : '还没有现场照片，点右上角「添加照片」'}
        />
      ) : (
        <>
          <Image.PreviewGroup>
            <div className="photo-wall">
              {shown.map((a) => (
                <div className="photo-wall-item" key={a.id}>
                  <Image
                    src={buildMediaUrl(a.rel_path)}
                    alt={a.file_name}
                    loading="lazy"
                    width="100%"
                    height="100%"
                    style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                    preview={{
                      // 预览时展示原文件名与大小，比只看到一张图更有用
                      imageRender: undefined,
                      mask: (
                        <Tooltip title={`${a.file_name}（${formatBytes(a.size_bytes)}）`}>
                          <span style={{ fontSize: 12 }}>点击查看大图</span>
                        </Tooltip>
                      )
                    }}
                  />
                  <Popconfirm
                    title="删除这张照片？"
                    description="文件会同时从磁盘删除，无法恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void onRemove(a.id)}
                  >
                    <span className="photo-wall-remove" title={`删除 ${a.file_name}`}>
                      <DeleteOutlined />
                    </span>
                  </Popconfirm>
                </div>
              ))}
            </div>
          </Image.PreviewGroup>

          {items.length > visible && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Button size="small" onClick={() => setVisible((v) => v + PAGE_STEP)}>
                加载更多（还有 {items.length - visible} 张）
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
