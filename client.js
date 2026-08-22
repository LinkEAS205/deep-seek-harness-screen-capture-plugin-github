window.__ModuleLoader__.load({
  id: 'dsh-client-screen-snap',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const RECOGNIZE_PATH = '/api/dsh-screen-snap/recognize'
    const INJECT = ['slots']

    async function recognize(dataUrl, prompt, sessionId) {
      const response = await fetch(RECOGNIZE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl, prompt, sessionId }),
      })
      const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const store = {
        open: false,
        status: 'idle',
        previewUrl: '',
        prompt: '',
        error: '',
        sessionId: undefined,
      }
      const listeners = new Set()
      const notify = () => { for (const fn of Array.from(listeners)) fn() }
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

      ctx.effect(() => () => { listeners.clear() }, 'dsh-client-screen-snap: store cleanup')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'screen-snap', order: 90, label: '截图识别' },
        (props) => {
          const sessionId = props && props.sessionId
          return React.createElement('button', {
            className: 'scap-trigger',
            onClick: () => {
              store.prompt = ''
              store.previewUrl = ''
              store.error = ''
              store.sessionId = sessionId
              store.open = true
              store.status = 'idle'
              notify()
            },
            title: '实时框选截图并识别',
          },
            React.createElement('svg', {
              width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { marginRight: 5, flexShrink: 0 },
            },
              React.createElement('rect', { x: 3, y: 7, width: 18, height: 13, rx: 2 }),
              React.createElement('circle', { cx: 12, cy: 13.5, r: 3.2 }),
              React.createElement('polygon', { points: '9 7 11 4 13 4 15 7' }),
            ),
            '截图识别')
        },
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'screen-snap-overlay', order: 90, label: '截图识别' },
        () => React.createElement(CaptureView, { store, subscribe, recognize }),
      ))

      // 注入玻璃拟态样式：直接用 DOM（与 frosted-glass 相同方式，避免 styles 服务不可用）
      const cssTagId = 'dsh-client-screen-snap/global.css'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTagId) + ']') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-client-screen-snap'
        tag.dataset.pluginCss = cssTagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }

    const CSS = [
      '.scap-trigger{display:inline-flex;align-items:center;justify-content:center;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);color:rgba(255,255,255,0.92);font-size:13px;cursor:pointer;user-select:none;line-height:1;transition:background .15s ease,border-color .15s ease}',
      '.scap-trigger:hover{background:rgba(255,255,255,0.17);border-color:rgba(255,255,255,0.32)}',
      '.scap-overlay{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(18,18,24,0.5);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);user-select:none;-webkit-user-select:none}',
      '.scap-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;color:#fff;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,0.18)}',
      '.scap-stage{position:relative;width:90vw;max-width:1200px;height:72vh;background:rgba(0,0,0,0.32);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
      '.scap-stage.capturing{cursor:crosshair}',
      '.scap-btn{padding:7px 14px;border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:13px;transition:background .15s ease}',
      '.scap-btn:hover{background:rgba(255,255,255,0.19)}',
      '.scap-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.scap-btn.primary{background:rgba(76,154,255,0.3);border-color:rgba(76,154,255,0.55)}',
      '.scap-btn.primary:hover{background:rgba(76,154,255,0.44)}',
      '.scap-preview{flex:1 1 auto;min-height:0;position:relative;border-radius:10px;overflow:hidden;background:rgba(0,0,0,0.25)}',
      '.scap-preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}',
      '.scap-prep{position:absolute;inset:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;color:#fff;background:rgba(0,0,0,0.4);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-sizing:border-box;padding:12px;gap:10px}',
      '.scap-prep .row{display:flex;gap:8px;justify-content:center;align-items:center}',
      '.scap-prep .status{text-align:center;font-size:13px}',
      '.scap-input{margin-top:12px;width:90%;max-width:1200px;padding:10px 13px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font-size:14px;outline:none;box-sizing:border-box}',
      '.scap-input::placeholder{color:rgba(255,255,255,0.55)}',
      '.scap-msg.error{color:#ff8a8a}',
    ].join('')

    function CaptureView(props) {
      const { store, subscribe, recognize } = props
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])

      const boxRef = React.useRef(null)
      const videoRef = React.useRef(null)
      const mediaRef = React.useRef(null)
      const [stream, setStream] = React.useState(null)
      const [boxSize, setBoxSize] = React.useState(null)
      const [sel, setSel] = React.useState({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
      const timer = props.timer

      React.useEffect(() => {
        const v = videoRef.current
        if (v && stream) { v.srcObject = stream; v.play().catch(() => {}) }
      }, [stream])

      React.useEffect(() => {
        const v = videoRef.current
        if (!v || !stream) return
        const onMeta = () => {
          const iw = v.videoWidth
          const ih = v.videoHeight
          if (!iw || !ih) return
          const availW = Math.min(window.innerWidth * 0.9, 1200)
          const availH = window.innerHeight * 0.72
          const scale = Math.min(availW / iw, availH / ih)
          setBoxSize({ w: Math.round(iw * scale), h: Math.round(ih * scale) })
        }
        if (v.readyState >= 1) onMeta()
        else v.addEventListener('loadedmetadata', onMeta)
        return () => v.removeEventListener('loadedmetadata', onMeta)
      }, [stream])

      if (!store.open) return null

      const notify_ = () => force((n) => n + 1)

      const close = () => {
        if (mediaRef.current) mediaRef.current.getTracks().forEach((t) => t.stop())
        store.open = false
        store.status = 'idle'
        setStream(null)
        setBoxSize(null)
        setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
        store.previewUrl = ''
        store.error = ''
        notify_()
      }

      const startCapture = async () => {
        try {
          const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
          mediaRef.current = s
          setStream(s)
          store.status = 'capturing'
          setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
          notify_()
        } catch (e) {
          store.status = 'error'
          store.error = '无法截屏：' + String(e && e.message ? e.message : e)
          notify_()
        }
      }

      const onDown = (e) => {
        if (store.status !== 'capturing') return
        if (!boxSize) return
        const r = boxRef.current.getBoundingClientRect()
        setSel({ active: true, sx: e.clientX - r.left, sy: e.clientY - r.top, ex: e.clientX - r.left, ey: e.clientY - r.top })
      }
      const onMove = (e) => {
        if (!sel.active) return
        const r = boxRef.current.getBoundingClientRect()
        setSel((c) => ({ ...c, ex: e.clientX - r.left, ey: e.clientY - r.top }))
      }
      const onUp = () => {
        if (!sel.active) return
        setSel((c) => ({ ...c, active: false }))
        crop(sel)
      }

      const crop = (c) => {
        const v = videoRef.current
        if (!v || !v.videoWidth) { store.status = 'error'; store.error = '尚未获取到画面帧'; notify_(); return }
        if (!boxSize) { store.status = 'error'; store.error = '画面尺寸尚未就绪'; notify_(); return }

        const stageW = boxSize.w
        const stageH = boxSize.h
        const iw = v.videoWidth
        const ih = v.videoHeight
        const scale = Math.min(stageW / iw, stageH / ih)
        const dispW = iw * scale
        const dispH = ih * scale
        const offX = (stageW - dispW) / 2
        const offY = (stageH - dispH) / 2

        const selX = Math.min(c.sx, c.ex) - offX
        const selY = Math.min(c.sy, c.ey) - offY
        const selX2 = Math.max(c.sx, c.ex) - offX
        const selY2 = Math.max(c.sy, c.ey) - offY
        const x = Math.max(0, selX) / scale
        const y = Math.max(0, selY) / scale
        const w = (Math.min(iw, selX2) - Math.max(0, selX)) / scale
        const h = (Math.min(ih, selY2) - Math.max(0, selY)) / scale
        if (w < 2 || h < 2) { store.status = 'error'; store.error = '框选区域过小'; notify_(); return }

        const out = document.createElement('canvas')
        out.width = Math.max(1, Math.floor(w))
        out.height = Math.max(1, Math.floor(h))
        out.getContext('2d').drawImage(v, x, y, w, h, 0, 0, w, h)
        const dataUrl = out.toDataURL('image/png')
        if (mediaRef.current) mediaRef.current.getTracks().forEach((t) => t.stop())
        mediaRef.current = null
        setStream(null)
        store.previewUrl = dataUrl
        store.status = 'confirm'
        notify_()
      }

      const confirmSend = async () => {
        store.status = 'uploading'
        notify_()
        try {
          await recognize(store.previewUrl, store.prompt, store.sessionId)
          store.status = 'done'
          store.error = ''
        } catch (e) {
          store.status = 'error'
          store.error = '上传异常：' + String(e && e.message ? e.message : e)
        }
        notify_()
      }

      const reselect = () => {
        store.status = 'idle'
        store.previewUrl = ''
        store.error = ''
        setBoxSize(null)
        setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
        notify_()
      }

      const promptChange = (e) => { store.prompt = e.target.value }

      const selW = Math.abs(sel.ex - sel.sx)
      const selH = Math.abs(sel.ey - sel.sy)
      const selX = Math.min(sel.sx, sel.ex)
      const selY = Math.min(sel.sy, sel.ey)
      const busy = store.status === 'capturing' || store.status === 'uploading'
      const showPrompt = store.status === 'idle' || store.status === 'capturing' || store.status === 'confirm'
      const stageCls = 'scap-stage' + (store.status === 'capturing' ? ' capturing' : '')
      const inResult = store.status === 'confirm' || store.status === 'uploading' || store.status === 'done' || store.status === 'error'

      return React.createElement('div', { className: 'scap-overlay' },
        React.createElement('div', { className: 'scap-toolbar' },
          React.createElement('span', null,
            store.status === 'idle' ? '点「开始截屏」，然后拖拽框选要识别的区域'
              : store.status === 'capturing' ? '已共享：请拖拽框选识别区域'
                : store.status === 'confirm' ? '已裁剪：请在下方预览确认后发送'
                  : store.status === 'uploading' ? '上传识别中…' : ''),
          React.createElement('button', { className: 'scap-btn', onClick: startCapture, disabled: busy },
            store.status === 'capturing' ? '正在共享…' : '开始截屏'),
          React.createElement('button', { className: 'scap-btn', onClick: close }, '取消'),
        ),

        React.createElement('div', {
          className: stageCls,
          ref: boxRef,
          onPointerDown: onDown,
          onPointerMove: onMove,
          onPointerUp: onUp,
          style: boxSize ? { width: boxSize.w, height: boxSize.h } : { width: '90vw', maxWidth: 1200, height: '72vh' },
        },
          store.status === 'capturing'
            ? React.createElement('video', {
              ref: videoRef, muted: true, autoPlay: true, playsInline: true,
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none' },
            })
            : null,

          store.status === 'capturing' && selW > 1 && selH > 1
            ? React.createElement('div', {
              style: {
                position: 'absolute', left: selX, top: selY, width: selW, height: selH,
                boxShadow: '0 0 0 99999px rgba(0,0,0,0.5)',
                border: '2px solid #4c9aff', pointerEvents: 'none',
              },
            })
            : null,

          inResult
            ? React.createElement('div', { className: 'scap-prep' },
              store.previewUrl
                ? React.createElement('div', { className: 'scap-preview' },
                  React.createElement('img', { src: store.previewUrl }),
                )
                : null,
              store.status === 'confirm'
                ? React.createElement('div', { className: 'row' },
                  React.createElement('button', { className: 'scap-btn primary', onClick: confirmSend }, '✅ 确认发送'),
                  React.createElement('button', { className: 'scap-btn', onClick: reselect }, '↺ 重新框选'),
                )
                : null,
              store.status === 'uploading' ? React.createElement('div', { className: 'status' }, '上传并识别中…') : null,
              store.status === 'done' ? React.createElement('div', { className: 'status' }, '已把截图发送进会话，模型将开始识别（可继续追问）。') : null,
              store.status === 'error' ? React.createElement('div', { className: 'status' }, React.createElement('span', { className: 'scap-msg error' }, store.error)) : null,
              store.status === 'done' || store.status === 'error'
                ? React.createElement('div', { className: 'row' },
                  React.createElement('button', { className: 'scap-btn', onClick: close }, '关闭'),
                )
                : null,
            )
            : null,

          store.status === 'idle'
            ? React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' } }, '点「开始截屏」后将在画面上框选')
            : null,
        ),

        showPrompt
          ? React.createElement('input', {
            className: 'scap-input',
            value: store.prompt,
            onChange: promptChange,
            placeholder: '可选：想让模型识别什么（默认识别截图内容）',
          })
          : null,
      )
    }

    exports.inject = INJECT
    exports.apply = apply
    return module.exports
  },
})
