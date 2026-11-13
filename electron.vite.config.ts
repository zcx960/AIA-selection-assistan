import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
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
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    server: {
      // Pre-compile every entry while vite boots: the prebuilt toolbar window
      // requests its page right after electron spawns, and a cold on-demand
      // compile left selections "dead" for the first tens of seconds.
      warmup: {
        clientFiles: [
          './settings.html',
          './selectionToolbar.html',
          './selectionAction.html',
          './chat.html',
          './screenshotOverlay.html',
          './screenshotPreview.html',
          './screenshotPin.html'
        ]
      }
    },
    build: {
      rollupOptions: {
        input: {
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          selectionToolbar: resolve(__dirname, 'src/renderer/selectionToolbar.html'),
          selectionAction: resolve(__dirname, 'src/renderer/selectionAction.html'),
          screenshotOverlay: resolve(__dirname, 'src/renderer/screenshotOverlay.html'),
          screenshotPreview: resolve(__dirname, 'src/renderer/screenshotPreview.html'),
          screenshotPin: resolve(__dirname, 'src/renderer/screenshotPin.html'),
          recordingOverlay: resolve(__dirname, 'src/renderer/recordingOverlay.html'),
          recording: resolve(__dirname, 'src/renderer/recording.html'),
          chat: resolve(__dirname, 'src/renderer/chat.html')
        }
      }
    }
  }
})
