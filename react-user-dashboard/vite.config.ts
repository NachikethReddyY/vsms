import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'

export default defineConfig(({ command, mode }) => {

  const env = loadEnv(mode, process.cwd(), '')

  const keyPath = "./certs/localhost-key.pem"
  const certPath = "./certs/localhost.pem"


  const localHttps =
    command === "serve" &&
    env.DEV_HTTPS === "true" &&
    fs.existsSync(keyPath) &&
    fs.existsSync(certPath)

  return {

    plugins: [
      react(),
      tailwindcss()
    ],


    server: {

      host: "0.0.0.0",

      https: localHttps
        ? {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
          }
        : undefined,


      port: 5173,

      strictPort: true,


      proxy: {

        "/api/v1": {

          target: "http://127.0.0.1:5050",

          changeOrigin: true,

          secure: false

        }

      }

    }

  }

})
