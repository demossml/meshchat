/**
 * Cloudflare Pages Functions — все /api/* маршруты через Hono
 * Файл: functions/api/[[route]].ts
 * Это edge-функция — работает на серверах Cloudflare по всему миру
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handle } from 'hono/cloudflare-pages'

const app = new Hono().basePath('/api')

app.use('*', cors({ origin: '*' }))

/** Healthcheck — клиент проверяет что CF Worker доступен */
app.get('/health', (c) => {
  const reqWithCf = c.req.raw as Request & { cf?: { colo?: string } }
  return c.json({ ok: true, region: reqWithCf.cf?.colo ?? 'unknown', ts: Date.now() })
})

/**
 * Конфигурация устройства по умолчанию.
 * Клиент запрашивает его при старте чтобы получить дефолтный IP.
 * Можно переопределить через CF Environment Variables.
 */
app.get('/config', (c) => {
  const env = c.env as Record<string, string>
  const parsedPort = parseInt(env.MESHTASTIC_WS_PORT ?? '80', 10)
  return c.json({
    defaultHost: env.MESHTASTIC_HOST ?? '192.168.0.1',
    defaultPort: Number.isFinite(parsedPort) ? parsedPort : 80,
    defaultPath: env.MESHTASTIC_WS_PATH ?? '/ws',
    appVersion:  '2.0.0',
  })
})

export const onRequest = handle(app)
