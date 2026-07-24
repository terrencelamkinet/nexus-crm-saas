import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-design-pages',
      configureServer(server) {
        server.middlewares.use((req: any, res: any, next: any) => {
          const url = req.url || ''

          // Proxy /api/* to FastAPI auth backend
          if (url.startsWith('/api/') || url.startsWith('/health')) {
            const http = require('http')
            const options = {
              hostname: '127.0.0.1',
              port: 8001,
              path: url,
              method: req.method,
              headers: { ...req.headers, host: '127.0.0.1:8001' }
            }
            const proxyReq = http.request(options, (proxyRes: any) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
              proxyRes.pipe(res)
            })
            proxyReq.on('error', () => { res.statusCode = 502; res.end('Bad Gateway') })
            if (req.body) proxyReq.write(req.body)
            req.pipe ? req.pipe(proxyReq) : proxyReq.end()
            return
          }

          // Handle design paths (static demo pages)
          if (url === '/design02' || url.startsWith('/design02/') ||
              url === '/design01' || url.startsWith('/design01/') ||
              url === '/design03' || url.startsWith('/design03/') ||
              url === '/design04' || url.startsWith('/design04/')) {
            const cleanPath = url.split('?')[0].replace(/\/+$/, '') || '/'
            let filePath = path.resolve(__dirname, 'public', cleanPath.slice(1))
            try {
              if (fs.statSync(filePath).isDirectory()) {
                filePath = path.join(filePath, 'index.html')
              }
            } catch { filePath = '' }
            if (filePath && fs.existsSync(filePath)) {
              const ext = path.extname(filePath)
              const ct = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html'
              const content = fs.readFileSync(filePath, 'utf-8')
              res.writeHead(200, { 'Content-Type': ct })
              return res.end(content)
            }
          }

          // Serve public/ static files: root, /login/, /portal/, /css/, /js/, /data/, /*.html
          // BEFORE the SPA fallback
          const urlPath = url.split('?')[0].replace(/\/+$/, '') || '/'
          
          // Skip if this is a Vite internal request
          if (urlPath.startsWith('/@') || urlPath.startsWith('/node_modules') || urlPath.startsWith('/__')) {
            return next()
          }

          // Determine possible file path in public/
          let filePath = ''
          if (urlPath === '/') {
            filePath = path.resolve(__dirname, 'public', 'index.html')
          } else if (urlPath === '/login' || urlPath === '/login/') {
            // Redirect old login portal to new React SPA sign-in
            res.writeHead(302, { 'Location': '/sign-in' })
            return res.end()
          } else if (urlPath === '/portal' || urlPath === '/portal/') {
            filePath = path.resolve(__dirname, 'public', 'portal', 'index.html')
          } else if (urlPath.startsWith('/css/') || urlPath.startsWith('/js/') || urlPath.startsWith('/data/')) {
            filePath = path.resolve(__dirname, 'public', urlPath.slice(1))
          } else if (urlPath.endsWith('.html')) {
            // Direct .html file reference - try public/ directly
            filePath = path.resolve(__dirname, 'public', urlPath.slice(1))
            if (!fs.existsSync(filePath)) {
              // Try with .html appended (for bare paths like /features)
              filePath = path.resolve(__dirname, 'public', urlPath.slice(1) + '.html')
            }
          } else if (!path.extname(urlPath)) {
            // Bare path like /features, /pricing, etc. - try as .html in public/
            filePath = path.resolve(__dirname, 'public', urlPath.slice(1) + '.html')
          }

          if (filePath && fs.existsSync(filePath)) {
            const ext = path.extname(filePath)
            let ct = 'text/html'
            if (ext === '.css') ct = 'text/css'
            else if (ext === '.js') ct = 'application/javascript'
            else if (ext === '.json') ct = 'application/json'
            else if (ext === '.svg') ct = 'image/svg+xml'
            else if (ext === '.png') ct = 'image/png'
            else if (ext === '.webp') ct = 'image/webp'
            else if (ext === '.ico') ct = 'image/x-icon'
            const content = fs.readFileSync(filePath, 'utf-8')
            res.writeHead(200, { 'Content-Type': ct })
            return res.end(content)
          }

          next()
        })
      }
    }
  ],
  server: {
    allowedHosts: ['nexus-crm.kinet-poc.com'],
  },
})
