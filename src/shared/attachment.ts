/**
 * 附件的两端共用定义。
 *
 * 视频/图片这类文件不能直接给渲染层一个 file:// 路径：CSP 是 img-src 'self' data: blob:，
 * file: 不在允许范围内；而且开发态页面跑在 http://localhost 上，webSecurity 也会拦。
 * 所以主进程注册一个私有协议，渲染层只拿到一个不透露真实磁盘路径的 URL。
 */

/** 私有协议名。改这里要同步改 src/renderer/index.html 的 CSP。 */
export const MEDIA_SCHEME = 'fwjc-media'

/** URL 里的固定 host，用来把 fwjc-media://media/... 解析成路径 */
export const MEDIA_HOST = 'media'

/** 允许上传的照片扩展名（小写、不含点） */
export const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif'
] as const

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif'
}

/** 从文件名取小写扩展名（不含点）；取不到返回空串 */
export function extFromFileName(name: string): string {
  const m = String(name).match(/\.([A-Za-z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

export function mimeFromExt(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null
}

export function isImageExt(ext: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
}

/**
 * 拼出渲染层可用的图片地址。
 * relPath 形如 `<project_id>/<uuid>.jpg`，两段都是纯 ASCII，不需要再编码。
 */
export function buildMediaUrl(relPath: string): string {
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${relPath}`
}

/** 把字节数变成人看的字符串 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
