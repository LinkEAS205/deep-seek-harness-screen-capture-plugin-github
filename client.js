window.__ModuleLoader__.load({
  id: 'dsh-client-screen-snap',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const SELECT_PATH = '/api/dsh-screen-snap/select'
    const INJECT = ['slots']

    const SELECT_TIMEOUT_MS = 165000

    /** 放进输入栏的那张图在 composer 附件栏里显示的文件名。 */
    const DROP_FILE_NAME = 'screenshot.png'

    /** 合成 drop 之后，等附件真正落进 composer 的上限（超时即判定没放进去）。 */
    const PLACE_VERIFY_MS = 2000

    /**
     * 把 data URL 变成浏览器 File —— composer 的附件通路认的是 File / dataTransfer.files。
     * 不走 fetch(dataURL) 是为了不依赖 data: URL 的 fetch 支持，手工解码更稳。
     */
    function dataUrlToFile(dataUrl, name) {
      const comma = dataUrl.indexOf(',')
      if (comma < 0) throw new Error('截图数据格式异常')
      const header = dataUrl.slice(0, comma)
      const body = dataUrl.slice(comma + 1)
      const matched = /^data:([^;]+)/.exec(header)
      const type = matched === null ? 'image/png' : matched[1]
      const binary = atob(body)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return new File([bytes], name, { type: type })
    }

    /**
     * 把一张图放进 composer 的输入栏（不发送，交给用户自己配文字再发）。
     *
     * 为什么是「合成一次 drop」而不是直接调 API：DSH 公开的 InputActions 里，
     * 文字能用 setDraft() 写进去，但附件只有 addAttachments(ids)，而那种
     * DraftAttachmentId 由 ConversationController.createDrafts() 铸造，只在
     * package-private 的 ComposerBarInjected.addFiles 上露头，第三方插件够不着。
     * 而附件栏（ui-attachment 的 ComposerAttachments）在 document 上挂了 drop 监听，
     * 读 dataTransfer.files 后交给产品自己的 onAddFiles —— 于是这里合成一次 drop，
     * 复用产品自己的校验与创建通路，不复制它的任何逻辑（与工具箱 element.click() 同理）。
     *
     * ⚠️ 这是取巧手法。将来 DSH 若给插件开放正规的附件接口，这里应当换掉。
     */
    function placeIntoComposer(dataUrl) {
      const file = dataUrlToFile(dataUrl, DROP_FILE_NAME)
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      document.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dataTransfer,
        bubbles: true,
        cancelable: true,
      }))
      return file
    }

    function log() {
      try { console.log.apply(console, ['[screen-snap]'].concat(Array.prototype.slice.call(arguments))) } catch (_) {}
    }

    // 统一的 fetch 封装：带超时、带可外部中止的信号，并把失败原因说清楚。
    // 之前这里没有任何超时：/select 一旦挂住，浮层就会永远停在 selecting。
    async function requestJson(path, options, timeoutMs) {
      const body = options && options.body
      const external = options && options.signal
      const controller = new AbortController()
      let timedOut = false
      const onExternalAbort = () => { try { controller.abort() } catch (_) {} }
      if (external) {
        if (external.aborted) onExternalAbort()
        else external.addEventListener('abort', onExternalAbort)
      }
      const timer = setTimeout(() => { timedOut = true; try { controller.abort() } catch (_) {} }, timeoutMs)
      const started = Date.now()
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        })
        const parsed = await response.json().catch(() => ({ ok: false, error: 'HTTP ' + response.status }))
        log(path, response.status, (Date.now() - started) + 'ms')
        return { status: response.status, ok: response.ok, body: parsed }
      } catch (error) {
        const aborted = error && error.name === 'AbortError'
        log(path, 'failed', (Date.now() - started) + 'ms', aborted ? (timedOut ? 'timeout' : 'aborted') : String(error && error.message))
        if (aborted) {
          if (timedOut) throw new Error('等待本机框选超时（' + Math.round(timeoutMs / 1000) + ' 秒），请重试或改用浏览器共享')
          throw new Error('已取消本机框选')
        }
        throw error
      } finally {
        clearTimeout(timer)
        if (external) external.removeEventListener('abort', onExternalAbort)
      }
    }

    // QQ 式截屏：Host 弹原生全屏窗口直接在屏幕上框选；返回 { ok, dataUrl?, cancelled? }
    // signal 允许浮层关闭时中止等待（Host 侧会见到底层 socket 断开并杀掉原生窗口）。
    async function selectRegion(signal) {
      const result = await requestJson(SELECT_PATH, { body: '{}', signal }, SELECT_TIMEOUT_MS)
      const body = result.body
      if (result.status === 409 || (body && body.busy)) {
        const error = new Error(body && body.error ? body.error : '另一次框选正在进行，请先完成或取消它')
        error.busy = true
        throw error
      }
      if (!result.ok && !(body && body.cancelled)) throw new Error((body && body.error) || ('HTTP ' + result.status))
      return body
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const store = {
        open: false,
        status: 'idle',
        previewUrl: '',
        error: '',
        sessionId: undefined,
        elapsed: 0,
        busyHint: false,
        selectAbort: null,
        // 输入栏里当前的附件数。触发按钮每次渲染都会写一遍进来（它在 session 作用域的槽里，
        // 拿得到 useInput）；浮层靠它对比"放入前 / 放入后"，把静默失败变成明确报错。
        attachCount: -1,
        attachBefore: -1,
        // "放入输入栏"的校验定时器句柄（关闭浮层时要清掉）
        placeTimer: null,
      }
      const listeners = new Set()
      const notify = () => { for (const fn of Array.from(listeners)) fn() }
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

      ctx.effect(() => () => { listeners.clear() }, 'dsh-client-screen-snap: store cleanup')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'screen-snap', order: 90, label: '截图识别' },
        (props) => {
          const sessionId = props && props.sessionId
          // 这个槽是 session 作用域，标准 props 里带 useInput（输入机状态的 selector hook）。
          // 只借它读附件数量，作为"到底放进 composer 没有"的判据；props 里没有就退化成不校验。
          // 条件调用 hook 在这里是安全的：某个槽的 props 形状在它的生命周期里不会变。
          const useInput = props && props.useInput
          if (typeof useInput === 'function') {
            const count = useInput((state) => (
              state && state.attachmentIds ? state.attachmentIds.length : -1
            ))
            if (typeof count === 'number') store.attachCount = count
          }
          return React.createElement('button', {
            className: 'scap-trigger',
            onClick: () => {
              store.previewUrl = ''
              store.error = ''
              store.elapsed = 0
              store.busyHint = false
              store.sessionId = sessionId
              store.attachBefore = -1
              store.open = true
              store.status = 'selecting'
              log('trigger: sessionId=' + String(sessionId) + ' attachments=' + store.attachCount)
              notify()
            },
            title: '截取屏幕并放入输入栏（QQ 式框选）',
          },
            React.createElement('svg', {
              width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', flexShrink: 0 },
            },
              React.createElement('circle', { cx: 6, cy: 6, r: 3 }),
              React.createElement('path', { d: 'M8.12 8.12 12 12' }),
              React.createElement('path', { d: 'M20 4 8.12 15.88' }),
              React.createElement('circle', { cx: 6, cy: 18, r: 3 }),
              React.createElement('path', { d: 'M14.8 14.8 20 20' }),
            ))
        },
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'screen-snap-overlay', order: 90, label: '截图识别' },
        () => React.createElement(CaptureView, { store, subscribe, placeIntoComposer, selectRegion }),
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
      // 与 composer 左侧「+」「添加文件」同一个底板：DSH 的 .add 是 28×28 圆形、
      // 无边框、background: var(--dsw-specific-selector)。这里用同一套 token，
      // 所以切换主题/换肤时底板跟着一起变，而不是写死一个灰。
      '.scap-trigger{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:none;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector,rgba(255,255,255,0.12));color:var(--dsw-alias-label-primary,rgba(255,255,255,0.92));font-size:13px;line-height:1;cursor:pointer;user-select:none;-webkit-user-select:none;transition:background .15s ease,opacity .15s ease}',
      // 悬浮才降底板不透明度（同一个 hover token，再叠一层透明度）
      '.scap-trigger:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,0.18));opacity:.72}',
      '.scap-trigger:active{opacity:.55}',
      '.scap-trigger:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,rgba(76,154,255,.7));outline-offset:2px}',
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
      '.scap-msg.error{color:#ff8a8a}',
    ].join('')

    // 配文字这件事本来就在 composer 的草稿框里做，浮层不再重复一个提示词输入框。
    function CaptureView(props) {
      const { store, subscribe, placeIntoComposer, selectRegion } = props
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])

      const boxRef = React.useRef(null)
      const videoRef = React.useRef(null)
      const mediaRef = React.useRef(null)
      const [stream, setStream] = React.useState(null)
      const [boxSize, setBoxSize] = React.useState(null)
      const [sel, setSel] = React.useState({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })

      const notify_ = () => force((n) => n + 1)

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

      // QQ 式截屏：请求 Host 弹原生全屏框选窗口；取消则收起浮层；
      // Host 不可用（非 Windows / Host 报错）时回退浏览器共享模式。
      //
      // 这里修的是原先最要命的一环：selecting 曾经是个没有出口的候诊室——
      // 浮层谎称"已弹出全屏截屏窗口"，两个按钮被禁用、Esc 被吞掉，而
      // /select 请求没有任何超时。现在：带超时、可中止、等待秒数可见，
      // 失败原因在切换状态的同一帧就写进 store.error，不再被旧文案盖住。
      React.useEffect(() => {
        if (store.status !== 'selecting') return
        let cancelled = false
        const controller = new AbortController()
        store.selectAbort = controller
        store.elapsed = 0
        const ticker = setInterval(() => { if (!cancelled) { store.elapsed += 1; notify_() } }, 1000)
        const idle = setInterval(() => { if (!cancelled && store.status === 'selecting' && store.elapsed >= 8) { store.busyHint = true; notify_() } }, 1000)
        const clearTimers = () => { clearInterval(ticker); clearInterval(idle) }
        selectRegion(controller.signal).then((body) => {
          clearTimers()
          if (cancelled) return
          store.selectAbort = null
          if (body && body.ok && body.dataUrl) {
            store.previewUrl = body.dataUrl
            store.status = 'confirm'
            store.error = ''
            log('select ok', Math.round((body.dataUrl.length / 1024)) + 'KB base64')
            notify_()
            return
          }
          if (body && body.cancelled) {
            store.open = false
            store.status = 'idle'
            store.previewUrl = ''
            notify_()
            return
          }
          throw new Error(body && body.error ? body.error : '未知错误')
        }).catch((e) => {
          clearTimers()
          if (cancelled) return
          store.selectAbort = null
          const message = String(e && e.message ? e.message : e)
          log('select failed:', message)
          if (e && e.busy) {
            // 另一次框选占着锁：明确告知，而不是悄悄退回浏览器共享
            store.status = 'error'
            store.error = message + '（可在几秒后重试，或改用「浏览器共享」）'
            notify_()
            return
          }
          startCapture('本机框选不可用（' + message + '），已回退浏览器共享模式')
        })
        return () => {
          cancelled = true
          clearTimers()
          try { controller.abort() } catch (_) {}
          if (store.selectAbort === controller) store.selectAbort = null
        }
      }, [store.status])

      // Esc 取消（原生框选时 Esc 由原生窗口接管；输入框内不触发）
      React.useEffect(() => {
        if (!store.open) return
        const onKey = (e) => {
          if (e.key !== 'Escape') return
          const tag = e.target && e.target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          // selecting 期间也允许取消：close() 会中止 /select，Host 侧会杀掉原生窗口
          close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [store.open])

      if (!store.open) return null

      const close = () => {
        if (store.placeTimer) { clearInterval(store.placeTimer); store.placeTimer = null }
        if (store.selectAbort) {
          try { store.selectAbort.abort() } catch (_) {}
          store.selectAbort = null
        }
        if (mediaRef.current) mediaRef.current.getTracks().forEach((t) => t.stop())
        mediaRef.current = null
        store.open = false
        store.status = 'idle'
        setStream(null)
        setBoxSize(null)
        setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
        store.previewUrl = ''
        store.error = ''
        notify_()
      }

      // 回退路径：浏览器共享屏幕，实时画面框选。
      // 关键点：状态和原因要在 await 之前就写进 store。否则等待系统共享弹窗
      // 的那段时间里，浮层仍停在 selecting，继续谎称"已弹出全屏截屏窗口"。
      const startCapture = async (fallbackNote) => {
        store.status = 'capturing'
        store.error = fallbackNote || ''
        setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
        notify_()
        try {
          const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
          mediaRef.current = s
          setStream(s)
          store.error = fallbackNote || ''
          notify_()
        } catch (e) {
          store.status = 'error'
          store.error = (fallbackNote ? fallbackNote + '；浏览器共享也被拒绝：' : '无法截屏：')
            + String(e && e.message ? e.message : e)
          notify_()
        }
      }

      const onDown = (e) => {
        if (store.status !== 'capturing') return
        if (!boxSize) return
        const r = boxRef.current.getBoundingClientRect()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
        setSel({ active: true, sx: e.clientX - r.left, sy: e.clientY - r.top, ex: e.clientX - r.left, ey: e.clientY - r.top })
      }
      const onMove = (e) => {
        if (!sel.active) return
        const r = boxRef.current.getBoundingClientRect()
        setSel((c) => ({ ...c, ex: e.clientX - r.left, ey: e.clientY - r.top }))
      }
      const onUp = (e) => {
        if (!sel.active) return
        const r = boxRef.current.getBoundingClientRect()
        const end = { sx: sel.sx, sy: sel.sy, ex: e.clientX - r.left, ey: e.clientY - r.top }
        setSel((c) => ({ ...c, active: false, ex: end.ex, ey: end.ey }))
        crop(end)
      }

      // 回退路径：从浏览器共享视频流裁剪
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

      // 放入输入栏：合成一次 drop 交给 composer 自己的附件通路，然后**校验它真的进去了**。
      // 会话正忙时附件栏的 canAcceptDrop 为 false，那次 drop 会被静默忽略——不校验的话
      // 浮层会假装成功然后关掉，用户对着空输入栏发愣。这正是本插件历史上最典型的那类 bug。
      const place = () => {
        const before = store.attachCount
        store.attachBefore = before
        store.status = 'placing'
        store.error = ''
        notify_()
        let file
        try {
          file = placeIntoComposer(store.previewUrl)
        } catch (e) {
          store.status = 'error'
          store.error = '放入输入栏失败：' + String(e && e.message ? e.message : e)
          notify_()
          return
        }
        log('place:', file.name, Math.round(file.size / 1024) + 'KB', 'attachments before=' + before)
        const startedAt = Date.now()
        store.placeTimer = setInterval(() => {
          // attachCount < 0 表示拿不到输入机状态（props 里没有 useInput），此时无法校验，
          // 按成功处理——不能因为"校验不了"就把能用的功能卡死。
          const verified = store.attachCount < 0 || (before >= 0 && store.attachCount > before)
          if (verified) {
            clearInterval(store.placeTimer)
            store.placeTimer = null
            log('place: ok, attachments=' + store.attachCount)
            store.open = false
            store.status = 'idle'
            store.previewUrl = ''
            notify_()
            return
          }
          if (Date.now() - startedAt > PLACE_VERIFY_MS) {
            clearInterval(store.placeTimer)
            store.placeTimer = null
            store.status = 'error'
            store.error = '没能放进输入栏：会话可能正忙（附件栏此刻不接受新附件）。'
              + '等上一条发完再试，或改用「浏览器共享」。'
            notify_()
          }
        }, 100)
      }

      const startSelect = () => {
        if (store.status === 'selecting' || store.status === 'capturing' || store.status === 'placing') return
        store.status = 'selecting'
        store.previewUrl = ''
        store.error = ''
        store.elapsed = 0
        store.busyHint = false
        setStream(null)
        setBoxSize(null)
        setSel({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 })
        notify_()
      }

      const dragging = store.status === 'capturing'
      const selW = Math.abs(sel.ex - sel.sx)
      const selH = Math.abs(sel.ey - sel.sy)
      const selX = Math.min(sel.sx, sel.ex)
      const selY = Math.min(sel.sy, sel.ey)
      const busy = store.status === 'selecting' || store.status === 'capturing' || store.status === 'placing'
      const stageCls = 'scap-stage' + (dragging ? ' capturing' : '')
      const inResult = store.status === 'confirm' || store.status === 'placing' || store.status === 'error'
      const startLabel = store.status === 'selecting' ? '等待框选…'
        : store.status === 'capturing' ? '正在共享…'
          : '重新截屏'

      return React.createElement('div', { className: 'scap-overlay' },
        React.createElement('div', { className: 'scap-toolbar' },
          React.createElement('span', null,
            store.status === 'selecting'
              ? ('正在弹出本机截屏窗口… 已等待 ' + store.elapsed + ' 秒'
                + (store.busyHint ? '（若桌面没有出现冻结画面，可直接点「取消」退出）' : ''))
              : store.status === 'error' ? (store.error || '出错了')
                : store.status === 'capturing' ? (store.error || '已共享：请拖拽框选识别区域')
                  : store.status === 'confirm' ? '已框选：确认后放进输入栏，你自己配文字再发'
                    : store.status === 'placing' ? '正在放进输入栏…' : ''),
          React.createElement('button', { className: 'scap-btn', onClick: startSelect, disabled: busy }, startLabel),
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

          dragging && selW > 1 && selH > 1
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
                  React.createElement('img', {
                    src: store.previewUrl,
                    onError: () => {
                      store.status = 'error'
                      store.error = '截图数据无法解码（可能损坏），请重新框选'
                      notify_()
                    },
                  }),
                )
                : null,
              store.status === 'confirm'
                ? React.createElement('div', { className: 'row' },
                  React.createElement('button', { className: 'scap-btn primary', onClick: place }, '📎 放入输入栏'),
                  React.createElement('button', { className: 'scap-btn', onClick: startSelect }, '↺ 重新框选'),
                )
                : null,
              store.status === 'placing' ? React.createElement('div', { className: 'status' }, '正在放进输入栏…') : null,
              store.status === 'error' ? React.createElement('div', { className: 'status' }, React.createElement('span', { className: 'scap-msg error' }, store.error)) : null,
              store.status === 'error'
                ? React.createElement('div', { className: 'row' },
                  React.createElement('button', { className: 'scap-btn primary', onClick: place }, '📎 重试放入'),
                  React.createElement('button', { className: 'scap-btn', onClick: startSelect }, '↺ 重新框选'),
                  React.createElement('button', { className: 'scap-btn', onClick: () => startCapture('') }, '改用浏览器共享'),
                  React.createElement('button', { className: 'scap-btn', onClick: close }, '关闭'),
                )
                : null,
            )
            : null,

          store.status === 'idle'
            ? React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' } }, '点「重新截屏」后直接在屏幕上框选')
            : null,
          store.status === 'selecting'
            ? React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.65)', fontSize: 13 } },
              React.createElement('span', null, '正在启动本机框选窗口…'),
              React.createElement('span', { style: { opacity: 0.75 } }, '已等待 ' + store.elapsed + ' 秒'),
              store.busyHint
                ? React.createElement('span', { style: { opacity: 0.75, maxWidth: 420, textAlign: 'center' } }, '窗口迟迟没有出现：可以点上方「取消」退出，再重试一次。')
                : null,
            )
            : null,
        ),

      )
    }

    exports.inject = INJECT
    exports.apply = apply
    return module.exports
  },
})
