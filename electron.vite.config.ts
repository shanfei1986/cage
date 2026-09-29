import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // node:sqlite 是 Node 内置模块，必须保持 external，不能被 rollup 打包
        external: ['node:sqlite']
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    // 渲染进程要引用 src/shared（在 renderer root 之外），
    // 必须显式放行，否则开发模式下 Vite 会拒绝这个请求
    server: {
      fs: {
        allow: [resolve('.')]
      }
    },
    plugins: [react()]
  }
})
