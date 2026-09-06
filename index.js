export const name = 'dsh-client-screen-snap'
export const inject = ['webServer']

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export const RECOGNIZE_PATH = '/api/dsh-screen-snap/recognize'
export const GRAB_PATH = '/api/dsh-screen-snap/grab'

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

// 同源校验：浏览器发起的 POST 一定带 Origin；外站页面发起的跨域 POST Origin
// 与本机不符。Origin 缺省（curl 等非浏览器客户端）放行，与原行为兼容。
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  const scheme = origin.startsWith('https://') ? 'https://' : 'http://'
  return origin === scheme + host
}

// QQ 式整屏抓取：用 PowerShell（System.Drawing CopyFromScreen）抓取整个虚拟桌面，
// 返回 PNG data URL。SetProcessDPIAware 保证多屏/高缩放下拿到物理像素。
const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class U32 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex); }'
[void][U32]::SetProcessDPIAware()
$x = [U32]::GetSystemMetrics(76)
$y = [U32]::GetSystemMetrics(77)
$w = [U32]::GetSystemMetrics(78)
$h = [U32]::GetSystemMetrics(79)
if ($w -le 0 -or $h -le 0) { throw 'virtual screen size is zero' }
$bmp = New-Object System.Drawing.Bitmap -ArgumentList @($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size -ArgumentList @($w, $h)))
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`

// 导出以便独立测试；正常插件流程只通过 apply 注册路由使用
export function captureScreen() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('本地整屏截取仅支持 Windows'))
      return
    }
    const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
    })
    let out = ''
    let err = ''
    let done = false
    let timer
    const finish = (fn, val) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn(val)
    }
    timer = setTimeout(() => {
      child.kill()
      finish(reject, new Error('截屏超时（15s）'))
    }, 15000)
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.length > 96 * 1024 * 1024) {
        child.kill()
        finish(reject, new Error('截屏输出过大'))
      }
    })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      if (code !== 0 || out.length === 0) {
        finish(reject, new Error('截屏脚本失败: ' + (err.trim() || ('exit ' + code))))
        return
      }
      finish(resolve, 'data:image/png;base64,' + out.trim())
    })
  })
}

export async function apply(ctx) {
  // QQ 式截屏：本地抓整屏，浏览器端冻结后框选
  const grabHandler = async (req, res) => {
    if (req.method !== 'POST') {
      reply(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!sameOrigin(req)) {
      reply(res, 403, { ok: false, error: '拒绝跨域调用' })
      return
    }
    try {
      const dataUrl = await captureScreen()
      reply(res, 200, { ok: true, dataUrl })
    } catch (error) {
      reply(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  }

  const recognizeHandler = async (req, res) => {
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
    if (!sameOrigin(req)) {
      reply(res, 403, { ok: false, error: '拒绝跨域调用' })
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
    path: GRAB_PATH,
    handler: grabHandler,
  }), 'dsh-client-screen-snap: grab route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RECOGNIZE_PATH,
    handler: recognizeHandler,
  }), 'dsh-client-screen-snap: recognize route')
}
