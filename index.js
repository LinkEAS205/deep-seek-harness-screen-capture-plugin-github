export const name = 'dsh-client-screen-snap'
export const inject = ['webServer']

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const RECOGNIZE_PATH = '/api/dsh-screen-snap/recognize'
export const SELECT_PATH = '/api/dsh-screen-snap/select'
export const DIAG_PATH = '/api/dsh-screen-snap/diag'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(PLUGIN_DIR, '.diag')
const LOG_FILE = join(LOG_DIR, 'screen-snap.log')
const LOG_MAX_BYTES = 512 * 1024

// 单文件诊断日志：把每一次框选的阶段耗时 / 退出码 / stderr 摘要追加进去，
// 并在超过上限时轮转一次。这是"偶发卡住"事后归因的唯一证据来源。
function logLine(entry) {
  const line = JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n'
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    try {
      if (statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, LOG_FILE + '.1')
    } catch {}
    appendFileSync(LOG_FILE, line, 'utf8')
  } catch {}
}

function readLog(maxLines = 60) {
  try {
    const text = readFileSync(LOG_FILE, 'utf8')
    const lines = text.split('\n').filter((s) => s.length > 0)
    return lines.slice(-maxLines)
  } catch (error) {
    return ['<no log: ' + String(error && error.message ? error.message : error) + '>']
  }
}

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


// Add-Type 的兜底版本：helper dll 不可用时现场编译。
// 类名与 dll 内一致，重复加载也不会致命。
const INLINE_TYPE_SOURCE =
  'using System;using System.Runtime.InteropServices;'
  + 'public static class ScapNative{'
  + '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  + '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);'
  + '[DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();'
  + '[DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr ctx);'
  + '[DllImport("user32.dll")] public static extern bool IsProcessDPIAware();'
  + '[DllImport("user32.dll")] public static extern uint GetDpiForSystem();'
  + '[DllImport("user32.dll",SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr hWnd);'
  + '[DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);'
  + '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
  + '[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);'
  + '}'

// QQ 式原生框选：PowerShell(WinForms) 抓整个虚拟桌面后弹一个无边框、置顶、
// 铺满全部显示器的原生窗口，按物理像素 1:1 显示冻结画面，用户直接在"屏幕"上
// 拖拽框选（选区外变暗、选区亮起、跟随显示尺寸），Esc/右键取消，松手即裁剪。
//
// 退出码协议：
//   0 = 框选成功，stdout 是 PNG base64
//   3 = 用户取消（Esc / 右键），stdout 为空
//   4 = 窗口看门狗超时（DSH_SNAP_WINDOW_MS），stdout 为空
//   1 = 脚本报错
//
// stderr 始终输出一行 `SCAP <json>`，含各阶段耗时与失败原因，父进程解析它
// 写进诊断日志——这是"偶发卡住"唯一可事后归因的证据。
//
// DSH_SNAP_SELFTEST=1 时跳过窗口（自测模式，直接输出整屏图）。
// DSH_SNAP_WINDOW_MS 可覆盖看门狗时长（自测用）。
const SELECT_SCRIPT = [
  '$ErrorActionPreference = \'Stop\'',
  '$script:t0 = [DateTime]::UtcNow',
  'function Elapsed { return [int]([DateTime]::UtcNow - $script:t0).TotalMilliseconds }',
  '$script:width = 0',
  '$script:height = 0',
  '$script:cancelled = $false',
  '$script:reason = \'ok\'',
  '$script:timer = $null',
  '$script:shot = $null',
  '$script:form = $null',
  '$script:selStart = $null',
  '$script:selRect = $null',
  '$script:shown = $false',
  '$script:activated = $false',
  '',
  'try {',
  '  Add-Type -AssemblyName System.Drawing',
  '  Add-Type -AssemblyName System.Windows.Forms',
  '  $script:tAsm = Elapsed',
  '  try { Add-Type -TypeDefinition $env:DSH_SNAP_INLINE -ErrorAction Stop } catch {}',
  '  $script:tType = Elapsed',
  '  # DPI 认知必须一步到位设成 Per-Monitor-Aware V2。',
  '  # 只用旧的 SetProcessDPIAware()（system-DPI aware）时：系统 DPI 是 96，',
  '  # 而副屏是 1600x2560@200% 的竖屏，Windows 会把它的坐标虚拟化成 800x1280，',
  '  # GetSystemMetrics 报出的虚拟屏就只有 3520x1280 —— 抓屏与遮罩都只覆盖竖屏',
  '  # 上半屏，下半屏露出桌面。PMv2 下同一套调用返回真实的 3520x2560。',
  '  $script:dpiCtx = -1',
  '  try {',
  '    if ([ScapNative]::SetProcessDpiAwarenessContext([IntPtr](-4))) { $script:dpiCtx = 2 }',
  '    else { $script:dpiCtx = [ScapNative]::GetAwarenessFromDpiAwarenessContext([ScapNative]::GetThreadDpiAwarenessContext()) }',
  '  } catch {',
  '    try { [void][ScapNative]::SetProcessDPIAware(); $script:dpiCtx = 1 } catch { $script:dpiCtx = 0 }',
  '  }',
  '',
  '  $x = [ScapNative]::GetSystemMetrics(76)',
  '  $y = [ScapNative]::GetSystemMetrics(77)',
  '  $w = [ScapNative]::GetSystemMetrics(78)',
  '  $h = [ScapNative]::GetSystemMetrics(79)',
  '  if ($w -le 0 -or $h -le 0) { throw \'virtual screen size is zero\' }',
  '  $script:width = $w',
  '  $script:height = $h',
  '  $script:shot = New-Object System.Drawing.Bitmap -ArgumentList @($w, $h)',
  '  $g = [System.Drawing.Graphics]::FromImage($script:shot)',
  '  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size -ArgumentList @($w, $h)))',
  '  $g.Dispose()',
  '  $script:tShot = Elapsed',
  '',
  '  if ($env:DSH_SNAP_SELFTEST -eq \'1\') {',
  '    $ms0 = New-Object System.IO.MemoryStream',
  '    $script:shot.Save($ms0, [System.Drawing.Imaging.ImageFormat]::Png)',
  '    [Console]::Out.Write([Convert]::ToBase64String($ms0.ToArray()))',
  '    [Console]::Error.Write(\'SCAP \' + (@{ ok = $true; ms = Elapsed; selftest = $true; width = $w; height = $h } | ConvertTo-Json -Compress))',
  '    exit 0',
  '  }',
  '',
  '  $script:form = New-Object System.Windows.Forms.Form',
  '  $script:form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
  '  $script:form.ShowInTaskbar = $false',
  '  $script:form.TopMost = $true',
  '  $script:form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
  '  $script:form.Bounds = New-Object System.Drawing.Rectangle -ArgumentList @($x, $y, $w, $h)',
  '  $script:form.Cursor = [System.Windows.Forms.Cursors]::Cross',
  '  $script:form.KeyPreview = $true',
  '  try { $script:form.GetType().GetProperty(\'DoubleBuffered\', ([System.Reflection.BindingFlags]\'Instance,NonPublic\')).SetValue($script:form, $true) } catch {}',
  '',
  '  # 标准截图遮罩：冻结画面整体压暗（半透明，画面仍然看得见），选区再原样画回来，',
  '  # 所以唯一的"亮区"就是选区本身。早期版本只有 43% 黑，画面里白底窗口/视频透过',
  '  # 遮罩依旧发亮，看着像"没被框到"；这里加深到 ~62% 并保持可读。',
  '  $script:dim = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(158, 0, 0, 0))',
  '  $script:pen = New-Object System.Drawing.Pen -ArgumentList @([System.Drawing.Color]::FromArgb(255, 76, 154, 255), 2)',
  '  $script:penShadow = New-Object System.Drawing.Pen -ArgumentList @([System.Drawing.Color]::FromArgb(190, 0, 0, 0), 4)',
  '  $script:labelBg = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(215, 0, 0, 0))',
  '  $script:sizeFont = New-Object System.Drawing.Font -ArgumentList @(\'Segoe UI\', 9)',
  '',
  '  $script:form.Add_Paint({',
  '    $g = $_.Graphics',
  '    $sw = $script:shot.Width',
  '    $sh = $script:shot.Height',
  '    $g.DrawImage($script:shot, 0, 0, $sw, $sh)',
  '    $g.FillRectangle($script:dim, 0, 0, $sw, $sh)',
  '    $r = $script:selRect',
  '    if ($null -ne $r -and $r.Width -gt 0 -and $r.Height -gt 0) {',
  '      # 选区保持原样亮度（不压暗），边框 + 尺寸标签标出边界',
  '      $g.DrawImage($script:shot, $r, $r, [System.Drawing.GraphicsUnit]::Pixel)',
  '      $g.DrawRectangle($script:penShadow, $r)',
  '      $g.DrawRectangle($script:pen, $r)',
  '      $txt = \'{0} x {1}\' -f $r.Width, $r.Height',
  '      $tx = $r.Left + 2',
  '      $ty = $r.Top + $r.Height + 5',
  '      if (($ty + 20) -gt $sh) { $ty = $r.Top - 22 }',
  '      if ($tx -lt 0) { $tx = 0 }',
  '      if (($tx + 90) -gt $sw) { $tx = [Math]::Max(0, $sw - 92) }',
  '      $g.FillRectangle($script:labelBg, $tx, $ty, 86, 18)',
  '      $g.DrawString($txt, $script:sizeFont, [System.Drawing.Brushes]::White, ($tx + 4), ($ty + 2))',
  '    }',
  '    if (-not $script:shown) { $script:shown = $true; $script:tShown = Elapsed }',
  '    if (-not $script:activated) {',
  '      $script:activated = $true',
  '      try {',
  '        [void][ScapNative]::SetForegroundWindow($this.Handle)',
  '        [void][ScapNative]::SetActiveWindow($this.Handle)',
  '        $this.Activate()',
  '        $script:tActivated = Elapsed',
  '      } catch {}',
  '    }',
  '  })',
  '',
  '  $script:form.Add_MouseDown({',
  '    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {',
  '      $script:selStart = New-Object System.Drawing.Point -ArgumentList @([int]$_.X, [int]$_.Y)',
  '      $script:selRect = $null',
  '      $this.Invalidate()',
  '    } elseif ($_.Button -eq [System.Windows.Forms.MouseButtons]::Right) {',
  '      $script:cancelled = $true',
  '      $script:reason = \'contextmenu\'',
  '      $this.Close()',
  '    }',
  '  })',
  '',
  '  # 选区矩形统一在这里归一化：钳进画面范围，杜绝越界矩形画到窗口外或裁剪时抛异常',
  '  function SetSelRect([int]$cx, [int]$cy) {',
  '    if ($null -eq $script:selStart) { return }',
  '    $sx = $script:selStart.X',
  '    $sy = $script:selStart.Y',
  '    if ($cx -lt 0) { $cx = 0 }',
  '    if ($cy -lt 0) { $cy = 0 }',
  '    if ($cx -gt ($script:width - 1)) { $cx = $script:width - 1 }',
  '    if ($cy -gt ($script:height - 1)) { $cy = $script:height - 1 }',
  '    $script:selRect = New-Object System.Drawing.Rectangle -ArgumentList @([Math]::Min($sx, $cx), [Math]::Min($sy, $cy), [Math]::Abs($cx - $sx), [Math]::Abs($cy - $sy))',
  '  }',
  '',
  '  $script:form.Add_MouseMove({',
  '    if ($null -eq $script:selStart) { return }',
  '    if (-not ($_.Button -band [System.Windows.Forms.MouseButtons]::Left)) { return }',
  '    SetSelRect ([int]$_.X) ([int]$_.Y)',
  '    $this.Invalidate()',
  '  })',
  '',
  '  $script:form.Add_MouseUp({',
  '    if ($_.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }',
  '    if ($null -eq $script:selStart) { return }',
  '    SetSelRect ([int]$_.X) ([int]$_.Y)',
  '    $r = $script:selRect',
  '    $script:selStart = $null',
  '    # 手抖/轻点：4x4 以内不算框选，清掉选区继续等（否则会把一像素选区当成功）',
  '    if ($null -ne $r -and $r.Width -ge 4 -and $r.Height -ge 4) {',
  '      $this.Close()',
  '    } else {',
  '      $script:selRect = $null',
  '      $this.Invalidate()',
  '    }',
  '  })',
  '',
  '  $script:form.Add_KeyDown({',
  '    if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {',
  '      $script:cancelled = $true',
  '      $script:reason = \'escape\'',
  '      $this.Close()',
  '    }',
  '  })',
  '',
  '  # 看门狗：窗口一旦因任何原因收不到输入（未激活、被遮挡、鼠标不在屏幕上），',
  '  # 这里主动结束，把"永久卡住"变成有界的 150 秒 + 明确原因。',
  '  $timeoutMs = 150000',
  '  if ($env:DSH_SNAP_WINDOW_MS) { $timeoutMs = [int]$env:DSH_SNAP_WINDOW_MS }',
  '  $script:timer = New-Object System.Windows.Forms.Timer',
  '  $script:timer.Interval = 1000',
  '  $script:timer.Add_Tick({',
  '    if ((Elapsed) -ge $timeoutMs) {',
  '      $script:timer.Stop()',
  '      $script:cancelled = $true',
  '      $script:reason = \'watchdog\'',
  '      try { $script:form.Close() } catch {}',
  '    }',
  '  })',
  '  $script:timer.Start()',
  '',
  '  [System.Windows.Forms.Application]::Run($script:form)',
  '',
  '  $script:tRun = Elapsed',
  '  $script:timer.Stop()',
  '  $script:timer.Dispose()',
  '  $script:form.Dispose()',
  '  $script:form = $null',
  '} catch {',
  '  $script:reason = \'error\'',
  '  $script:err = $_.Exception.Message',
  '  [Console]::Error.Write(\'SCAP \' + (@{ ok = $false; stage = \'setup\'; reason = $script:reason; error = $script:err; ms = (Elapsed) } | ConvertTo-Json -Compress))',
  '  exit 1',
  '}',
  '',
  '$meta = @{ ok = $true; reason = $script:reason }',
  '  # 几何体检：虚拟屏原点/尺寸、表单实际客户区尺寸、DPI 认知状态。',
  '  # 副屏是 1600x2560 竖向屏时，只要抓屏尺寸被 DPI 虚拟化成一半，遮罩就只会盖住上半屏。',
  '  $meta.virt = @($x, $y, $w, $h)',
  '  if ($null -ne $script:form) {',
  '    $meta.form = @($script:form.ClientSize.Width, $script:form.ClientSize.Height)',
  '    $meta.formBounds = @($script:form.Bounds.X, $script:form.Bounds.Y, $script:form.Bounds.Width, $script:form.Bounds.Height)',
  '  }',
  '  $meta.dpiAware = [bool][ScapNative]::IsProcessDPIAware()',
  '  $meta.dpiCtx = $script:dpiCtx',
  '  try { $meta.dpiSystem = [int][ScapNative]::GetDpiForSystem() } catch {}',
  'foreach ($k in @(\'tAsm\',\'tType\',\'tShot\',\'tShown\',\'tActivated\',\'tRun\')) {',
  '  $v = Get-Variable -Name $k -ValueOnly -ErrorAction SilentlyContinue',
  '  if ($null -ne $v) { $meta[$k] = $v }',
  '}',
  '',
  'if ($script:cancelled -or $null -eq $script:selRect) {',
  '  if ($meta.reason -eq \'ok\') { $meta.reason = \'none\' }',
  '  $meta.ms = Elapsed',
  '  [Console]::Error.Write(\'SCAP \' + ($meta | ConvertTo-Json -Compress))',
  '  if ($meta.reason -eq \'watchdog\') { exit 4 }',
  '  exit 3',
  '}',
  '',
  'try {',
  '  $r = $script:selRect',
  '  $cropBmp = New-Object System.Drawing.Bitmap -ArgumentList @($r.Width, $r.Height)',
  '  $cg = [System.Drawing.Graphics]::FromImage($cropBmp)',
  '  $dst = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $r.Width, $r.Height)',
  '  $cg.DrawImage($script:shot, $dst, $r, [System.Drawing.GraphicsUnit]::Pixel)',
  '  $cg.Dispose()',
  '  $ms = New-Object System.IO.MemoryStream',
  '  $cropBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
  '  $cropBmp.Dispose()',
  '  $script:shot.Dispose()',
  '  [Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))',
  '  $meta.reason = \'selected\'',
  '  $meta.selW = $r.Width',
  '  $meta.selH = $r.Height',
  '  $meta.ms = Elapsed',
  '  [Console]::Error.Write(\'SCAP \' + ($meta | ConvertTo-Json -Compress))',
  '  exit 0',
  '} catch {',
  '  [Console]::Error.Write(\'SCAP \' + (@{ ok = $false; stage = \'crop\'; reason = \'error\'; error = $_.Exception.Message; ms = (Elapsed) } | ConvertTo-Json -Compress))',
  '  exit 1',
  '}',
].join('\n')

// 单次框选的阶段诊断。写进 .diag/screen-snap.log，并在 GET /diag 上读回。
const diag = {
  phase: 'idle',
  lastStartAt: 0,
  lastEndAt: 0,
  lastMs: 0,
  lastReason: '',
  lastExitCode: null,
  lastStage: null,
  lastError: null,
  lastGeom: null,
  busy: false,
  runs: 0,
}

function diagBegin() {
  diag.phase = 'starting'
  diag.busy = true
  diag.lastStartAt = Date.now()
  diag.lastReason = ''
  diag.lastError = null
  diag.lastExitCode = null
  diag.lastStage = null
  diag.lastGeom = null
  diag.runs += 1
}

function diagEnd(extra) {
  diag.phase = 'idle'
  diag.busy = false
  diag.lastEndAt = Date.now()
  diag.lastMs = diag.lastEndAt - diag.lastStartAt
  const entry = Object.assign({
    kind: 'select',
    ms: diag.lastMs,
    reason: diag.lastReason,
    exitCode: diag.lastExitCode,
    stage: diag.lastStage,
    error: diag.lastError,
    geom: diag.lastGeom,
  }, extra || {})
  logLine(entry)
  return entry
}

// 从脚本 stderr 里挑出 SCAP 前缀那一行（其余是 CLIXML 噪声，必须忽略）。
function parseScapMeta(text) {
  if (typeof text !== 'string') return null
  const idx = text.indexOf('SCAP ')
  if (idx < 0) return null
  let line = text.slice(idx + 5)
  const nl = line.indexOf('\n')
  if (nl >= 0) line = line.slice(0, nl)
  try {
    return JSON.parse(line.trim())
  } catch {
    return null
  }
}

// PNG 校验：base64 字符集 + PNG magic，防止把损坏的 stdout 当图片用。
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function validPngBase64(b64) {
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return false
  try {
    return Buffer.from(b64.slice(0, 24), 'base64').subarray(0, 8).equals(PNG_MAGIC)
  } catch {
    return false
  }
}

// 运行原生框选：resolve(dataUrl) 成功；resolve(null) 用户取消；reject 出错。
// 第二参数是可选的 { env, onChild } 钩子（自测 / 断线取消用）。
export function selectScreen(extraEnv, hooks) {
  const opts = hooks || {}
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('本地整屏截取仅支持 Windows，请使用浏览器共享模式'))
      return
    }
    const encoded = Buffer.from(SELECT_SCRIPT, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: Object.assign({}, process.env, { DSH_SNAP_INLINE: INLINE_TYPE_SOURCE }, extraEnv || {}),
    })
    if (typeof opts.onChild === 'function') {
      try { opts.onChild(child) } catch {}
    }
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
    // 外层兜底：脚本自带 150 秒窗口看门狗，这里再宽 20 秒防进程僵死。
    timer = setTimeout(() => {
      try { child.kill() } catch {}
      diag.lastStage = 'host-timeout'
      finish(reject, new Error('等待框选超时（170 秒，原生窗口未响应）'))
    }, 170000)
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.length > 96 * 1024 * 1024) {
        try { child.kill() } catch {}
        finish(reject, new Error('截屏输出过大'))
      }
    })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      const meta = parseScapMeta(err)
      diag.lastExitCode = code
      if (meta !== null) {
        diag.lastStage = {
          asm: meta.tAsm,
          type: meta.tType,
          shot: meta.tShot,
          shown: meta.tShown,
          activated: meta.tActivated,
          run: meta.tRun,
          selftest: meta.selftest,
        }
        // 几何体检结果：虚拟屏尺寸 vs 表单客户区 vs DPI 认知。两者不等就是"遮罩
        // 只盖住一部分屏幕"的直接证据（副屏 1600x2560 被虚拟化成 800x1280 时，
        // 表单只有 800x1280，正好只盖住竖屏的上半部分）。
        diag.lastGeom = {
          virt: meta.virt || null,
          form: meta.form || null,
          formBounds: meta.formBounds || null,
          dpiAware: meta.dpiAware === undefined ? null : meta.dpiAware,
          dpiSystem: meta.dpiSystem === undefined ? null : meta.dpiSystem,
          selW: meta.selW === undefined ? null : meta.selW,
          selH: meta.selH === undefined ? null : meta.selH,
        }
      }
      diag.lastReason = meta && meta.reason ? meta.reason : ('exit ' + code)
      if (code === 0) {
        const b64 = out.trim()
        if (b64.length === 0) {
          diag.lastError = '脚本成功退出但 stdout 为空'
          finish(reject, new Error('截屏脚本返回了空数据'))
          return
        }
        if (!validPngBase64(b64)) {
          diag.lastError = 'stdout 不是有效的 PNG base64'
          finish(reject, new Error('截屏数据损坏（PNG 校验失败），请重试'))
          return
        }
        finish(resolve, 'data:image/png;base64,' + b64)
        return
      }
      if (code === 3) {
        finish(resolve, null)
        return
      }
      if (code === 4) {
        diag.lastError = '原生窗口看门狗超时（窗口 150 秒内没有收到框选输入）'
        finish(reject, new Error(diag.lastError))
        return
      }
      const detail = meta && meta.error ? meta.error : 'exit ' + code
      diag.lastError = detail
      finish(reject, new Error('原生框选失败：' + detail))
    })
  })
}

export async function apply(ctx) {
  // 单飞锁 + 断线释放：客户端中途刷新/关页时，不能把锁和原生窗口一起留下。
  let selecting = false
  let activeChild = null

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
      logLine({ kind: 'select-rejected', reason: 'busy', busyMs: diag.busy ? Date.now() - diag.lastStartAt : null })
      reply(res, 409, { ok: false, busy: true, retryAfterMs: 2000, error: '已有一次框选正在进行，请先完成或取消它' })
      return
    }

    selecting = true
    diagBegin()
    let replied = false
    let clientGone = false
    const send = (status, body) => {
      if (replied) return
      replied = true
      if (clientGone) return
      reply(res, status, body)
    }
    // 客户端断开（刷新页面 / 关标签 / fetch abort）→ 杀掉原生窗口并释放锁
    const onClientGone = () => {
      clientGone = true
      diag.lastStage = 'client-aborted'
      diag.lastReason = 'client-aborted'
      if (activeChild !== null) {
        try { activeChild.kill() } catch {}
      }
    }
    req.on('aborted', onClientGone)
    res.on('close', () => { if (!res.writableEnded) onClientGone() })

    try {
      const dataUrl = await selectScreen(undefined, {
        onChild: (child) => { activeChild = child },
      })
      if (dataUrl === null) {
        diagEnd({ outcome: 'cancelled' })
        send(200, { ok: false, cancelled: true })
        return
      }
      const entry = diagEnd({ outcome: 'ok' })
      send(200, { ok: true, dataUrl, elapsedMs: entry.ms, reason: entry.reason })
    } catch (error) {
      const entry = diagEnd({ outcome: 'error' })
      send(500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
        reason: entry.reason,
        stage: entry.stage,
        elapsedMs: entry.ms,
      })
    } finally {
      activeChild = null
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
    let replied = false
    const send = (status, body) => {
      if (replied) return
      replied = true
      if (res.destroyed || res.writableEnded) return
      reply(res, status, body)
    }
    try {
      const payload = await readJsonBody(req)
      const dataUrl = payload && payload.dataUrl
      const prompt = (payload && typeof payload.prompt === 'string' && payload.prompt.length > 0)
        ? payload.prompt
        : '请识别这张截图的内容。'
      const sessionId = payload && payload.sessionId

      if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
        send(400, { ok: false, error: '无效的图片数据' })
        return
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        send(400, { ok: false, error: '缺少会话 id' })
        return
      }

      const comma = dataUrl.indexOf(',')
      const header = dataUrl.slice(0, comma)
      const data = dataUrl.slice(comma + 1)
      const m = /^data:([^;]+);base64$/.exec(header)
      const mediaType = (m ? m[1] : 'image/png')
      const content = [
        { type: 'image', mediaType, data, name: 'screenshot.png' },
        { type: 'text', text: prompt },
      ]

      // DSH >=0.1.5：sessionController.prompt(request, signal) 直调（本版本走这条）。
      const sessionController = ctx.get('sessionController')
      if (sessionController !== undefined && typeof sessionController.prompt === 'function') {
        const controller = new AbortController()
        const timer = setTimeout(() => {
          try { controller.abort() } catch {}
        }, 120000)
        // 客户端中途放弃时同样中止，避免 DSH 侧留下悬挂的图片注入。
        res.on('close', () => {
          if (!res.writableEnded) {
            try { controller.abort() } catch {}
          }
        })
        try {
          await sessionController.prompt({
            requestId: 'screen-snap-' + randomUUID(),
            sessionId,
            mode: 'queue',
            content,
          }, controller.signal)
        } finally {
          clearTimeout(timer)
        }
        logLine({ kind: 'recognize', ok: true, bytes: data.length })
        send(200, { ok: true })
        return
      }

      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined || apiProxy.sessions === undefined) {
        send(500, { ok: false, error: '会话服务不可用（sessionController / apiProxy 均未挂载）' })
        return
      }

      const response = await apiProxy.sessions.prompt({
        rpcId: 'screen-snap-' + randomUUID(),
        payload: {
          sessionId,
          mode: 'queue',
          content,
        },
      })

      if (response && response.result && response.result.ok) {
        send(200, { ok: true })
        return
      }
      const err = (response && response.result && !response.result.ok && response.result.error)
        ? response.result.error
        : { message: '消息发送失败' }
      send(400, { ok: false, error: err.message || '消息发送失败' })
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      logLine({ kind: 'recognize', ok: false, error: message })
      const tooLarge = message.indexOf('payload too large') >= 0
      send(tooLarge ? 413 : 500, {
        ok: false,
        error: tooLarge ? '截图体积过大（超过 20MB），请缩小框选范围' : message,
      })
    }
  }

  // 诊断端点：GET /api/dsh-screen-snap/diag —— 当前状态 + 最近一次框选阶段耗时 + 日志尾部。
  const diagHandler = async (req, res) => {
    if (req.method !== 'GET') {
      reply(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!sameOrigin(req)) {
      reply(res, 403, { ok: false, error: '拒绝跨域调用' })
      return
    }
    reply(res, 200, {
      ok: true,
      platform: process.platform,
      // 构建标记：用来确认宿主进程里加载的是哪一版模块（改完插件不重启宿主时仍是旧代码）
      build: 'pmv2-dpi-fix+geom-diag',
      state: {
        phase: diag.phase,
        busy: diag.busy,
        runs: diag.runs,
        lastMs: diag.lastMs,
        lastReason: diag.lastReason,
        lastExitCode: diag.lastExitCode,
        lastStage: diag.lastStage,
        lastError: diag.lastError,
        lastGeom: diag.lastGeom,
        lastStartAt: diag.lastStartAt > 0 ? new Date(diag.lastStartAt).toISOString() : null,
      },
      logTail: readLog(40),
    })
  }

  logLine({ kind: 'plugin-start', node: process.version })
  // 预热：首个 PowerShell 冷启动实测多花约 2.5 秒，这里提前把成本付掉。
  try {
    const warm = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$null = 1'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    warm.on('error', () => {})
    warm.on('close', () => {})
  } catch {}

  const register = (path, handler, label) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), label)
  }

  register(SELECT_PATH, selectHandler, 'dsh-client-screen-snap: select route')
  register(RECOGNIZE_PATH, recognizeHandler, 'dsh-client-screen-snap: recognize route')
  register(DIAG_PATH, diagHandler, 'dsh-client-screen-snap: diag route')
}
