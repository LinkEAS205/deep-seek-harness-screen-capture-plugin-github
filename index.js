export const name = 'dsh-client-screen-snap'
export const inject = ['webServer']

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export const RECOGNIZE_PATH = '/api/dsh-screen-snap/recognize'
export const SELECT_PATH = '/api/dsh-screen-snap/select'

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

// QQ 式原生框选：PowerShell(WinForms) 抓整个虚拟桌面后弹一个无边框、置顶、
// 铺满全部显示器的原生窗口，按物理像素 1:1 显示冻结画面，用户直接在"屏幕"上
// 拖拽框选（选区外变暗、选区亮起、跟随显示尺寸），Esc/右键取消，松手即裁剪。
// 框选结果以 PNG base64 写到 stdout；取消时退出码 3、无输出。
// DSH_SNAP_SELFTEST=1 时跳过窗口（自测模式，直接输出整屏图）。
const SELECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class U32 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex); }'
[void][U32]::SetProcessDPIAware()
$x = [U32]::GetSystemMetrics(76)
$y = [U32]::GetSystemMetrics(77)
$w = [U32]::GetSystemMetrics(78)
$h = [U32]::GetSystemMetrics(79)
if ($w -le 0 -or $h -le 0) { throw 'virtual screen size is zero' }
$script:shot = New-Object System.Drawing.Bitmap -ArgumentList @($w, $h)
$g = [System.Drawing.Graphics]::FromImage($script:shot)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size -ArgumentList @($w, $h)))
$g.Dispose()

if ($env:DSH_SNAP_SELFTEST -eq '1') {
  $ms0 = New-Object System.IO.MemoryStream
  $script:shot.Save($ms0, [System.Drawing.Imaging.ImageFormat]::Png)
  [Console]::Out.Write([Convert]::ToBase64String($ms0.ToArray()))
  exit 0
}

$script:cancelled = $false
$script:selStart = $null
$script:selRect = $null

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = New-Object System.Drawing.Rectangle -ArgumentList @($x, $y, $w, $h)
$form.Cursor = [System.Windows.Forms.Cursors]::Cross
$form.KeyPreview = $true
try { $form.GetType().GetProperty('DoubleBuffered', ([System.Reflection.BindingFlags]'Instance,NonPublic')).SetValue($form, $true) } catch {}

$script:dim = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(110, 0, 0, 0))
$script:pen = New-Object System.Drawing.Pen -ArgumentList @([System.Drawing.Color]::FromArgb(255, 76, 154, 255), 2)
$script:sizeFont = New-Object System.Drawing.Font -ArgumentList @('Segoe UI', 9)

$form.Add_Paint({
  $g = $_.Graphics
  $g.DrawImage($script:shot, 0, 0, $script:shot.Width, $script:shot.Height)
  $g.FillRectangle($script:dim, 0, 0, $script:shot.Width, $script:shot.Height)
  $r = $script:selRect
  if ($null -ne $r -and $r.Width -gt 0 -and $r.Height -gt 0) {
    $g.DrawImage($script:shot, $r, $r, [System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawRectangle($script:pen, $r)
    $g.DrawString(('{0} x {1}' -f $r.Width, $r.Height), $script:sizeFont, [System.Drawing.Brushes]::White, ($r.X + 3), ($r.Y + $r.Height + 4))
  }
})

$form.Add_MouseDown({
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:selStart = New-Object System.Drawing.Point -ArgumentList @([int]$_.X, [int]$_.Y)
    $script:selRect = $null
    $this.Invalidate()
  } elseif ($_.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
    $script:cancelled = $true
    $this.Close()
  }
})

$form.Add_MouseMove({
  if ($null -eq $script:selStart) { return }
  if (-not ($_.Button -band [System.Windows.Forms.MouseButtons]::Left)) { return }
  $sx = $script:selStart.X
  $sy = $script:selStart.Y
  $rx = [int][Math]::Min($sx, [int]$_.X)
  $ry = [int][Math]::Min($sy, [int]$_.Y)
  $rw = [int][Math]::Abs([int]$_.X - $sx)
  $rh = [int][Math]::Abs([int]$_.Y - $sy)
  $script:selRect = New-Object System.Drawing.Rectangle -ArgumentList @($rx, $ry, $rw, $rh)
  $this.Invalidate()
})

$form.Add_MouseUp({
  if ($_.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
  $r = $script:selRect
  $script:selStart = $null
  if ($null -ne $r -and $r.Width -ge 4 -and $r.Height -ge 4) {
    $this.Close()
  } else {
    $script:selRect = $null
    $this.Invalidate()
  }
})

$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $script:cancelled = $true
    $this.Close()
  }
})

[System.Windows.Forms.Application]::Run($form)
$form.Dispose()

if ($script:cancelled -or $null -eq $script:selRect) { exit 3 }
$r = $script:selRect
$cropBmp = New-Object System.Drawing.Bitmap -ArgumentList @($r.Width, $r.Height)
$cg = [System.Drawing.Graphics]::FromImage($cropBmp)
$dst = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $r.Width, $r.Height)
$cg.DrawImage($script:shot, $dst, $r, [System.Drawing.GraphicsUnit]::Pixel)
$cg.Dispose()
$ms = New-Object System.IO.MemoryStream
$cropBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$cropBmp.Dispose()
$script:shot.Dispose()
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
exit 0
`

// 运行原生框选：resolve(dataUrl) 成功；resolve(null) 用户取消；reject 出错。
// extraEnv 供自测注入环境变量。
export function selectScreen(extraEnv) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('本地整屏截取仅支持 Windows'))
      return
    }
    const encoded = Buffer.from(SELECT_SCRIPT, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, ...(extraEnv || {}) },
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
    // 交互式框选给足时间，用户可能停在选区上犹豫
    timer = setTimeout(() => {
      child.kill()
      finish(reject, new Error('等待框选超时（180 秒）'))
    }, 180000)
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
      if (code === 0 && out.trim().length > 0) {
        finish(resolve, 'data:image/png;base64,' + out.trim())
        return
      }
      if (code === 3) {
        finish(resolve, null)
        return
      }
      finish(reject, new Error('截屏脚本失败: ' + (err.trim() || ('exit ' + code))))
    })
  })
}

export async function apply(ctx) {
  let selecting = false

  // QQ 式框选：弹出原生全屏窗口拖拽选区，返回裁剪结果
  const selectHandler = async (req, res) => {
    if (req.method !== 'POST') {
      reply(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!sameOrigin(req)) {
      reply(res, 403, { ok: false, error: '拒绝跨域调用' })
      return
    }
    if (selecting) {
      reply(res, 409, { ok: false, error: '已有一次框选正在进行' })
      return
    }
    selecting = true
    try {
      const dataUrl = await selectScreen()
      if (dataUrl === null) {
        reply(res, 200, { ok: false, cancelled: true })
        return
      }
      reply(res, 200, { ok: true, dataUrl })
    } catch (error) {
      reply(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    } finally {
      selecting = false
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
    path: SELECT_PATH,
    handler: selectHandler,
  }), 'dsh-client-screen-snap: select route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RECOGNIZE_PATH,
    handler: recognizeHandler,
  }), 'dsh-client-screen-snap: recognize route')
}
