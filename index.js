export const name = 'dsh-client-screen-snap'
export const inject = ['webServer']

import { randomUUID } from 'node:crypto'

export const RECOGNIZE_PATH = '/api/dsh-screen-snap/recognize'

// 读取 JSON 请求体（限制大小，防止超大截图）
function readJsonBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function reply(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(data)
}

export async function apply(ctx) {
  const handler = async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'OPTIONS') {
      reply(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end()
      return
    }
    try {
      const payload = await readJsonBody(req)
      const dataUrl = payload && payload.dataUrl
      const prompt = (payload && typeof payload.prompt === 'string' && payload.prompt.length > 0)
        ? payload.prompt
        : '请识别这张截图的内容。'
      const sessionId = payload && payload.sessionId

      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined || apiProxy.sessions === undefined) {
        reply(res, 500, { ok: false, error: 'apiProxy 服务不可用' })
        return
      }

      if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
        reply(res, 400, { ok: false, error: '无效的图片数据' })
        return
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        reply(res, 400, { ok: false, error: '缺少会话 id' })
        return
      }

      const comma = dataUrl.indexOf(',')
      const header = dataUrl.slice(0, comma)
      const data = dataUrl.slice(comma + 1)
      const m = /^data:([^;]+);base64$/.exec(header)
      const mediaType = (m ? m[1] : 'image/png')

      const response = await apiProxy.sessions.prompt({
        rpcId: 'screen-snap-' + randomUUID(),
        payload: {
          sessionId,
          mode: 'queue',
          content: [
            { type: 'image', mediaType, data, name: 'screenshot.png' },
            { type: 'text', text: prompt },
          ],
        },
      })

      if (response && response.result && response.result.ok) {
        reply(res, 200, { ok: true })
        return
      }
      const err = (response && response.result && !response.result.ok && response.result.error)
        ? response.result.error
        : { message: '消息发送失败' }
      reply(res, 400, { ok: false, error: err.message || '消息发送失败' })
    } catch (error) {
      reply(res, 500, { ok: false, error: String(error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RECOGNIZE_PATH,
    handler,
  }), 'dsh-client-screen-snap: recognize route')
}
