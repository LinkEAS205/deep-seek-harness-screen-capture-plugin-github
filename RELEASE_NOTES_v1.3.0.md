# dsh-client-screen-snap v1.3.0

这一版修掉了一个影响**多显示器 / 高 DPI** 用户的硬伤，并把截图按钮的样式对齐了 DSH 自带控件。

This release fixes a hard bug for **multi-monitor / high-DPI** setups and aligns the trigger button with DSH's own controls.

---

## 🐛 修复 / Fixes

### 副屏遮罩只盖住一半 —— DPI 虚拟化导致的抓屏尺寸错误

- **现象**：副屏（竖屏）上，框选窗口的暗色遮罩只覆盖上半部分，下半部分直接露出桌面；抓到的图也只有上半屏。
- **根因**：脚本用 `SetProcessDPIAware()`（system-DPI aware）申请 DPI 认知。当某块屏的缩放与系统 DPI 不一致时，Windows 会把它的坐标**虚拟化**——例如 1600×2560 @200% 的竖屏只报 **800×1280**，于是 `GetSystemMetrics` 给出的虚拟屏高度是 1280 而不是 2560，抓屏尺寸、窗口尺寸、遮罩范围全部按 1280 算，正好只盖住竖屏上半截。
- **修复**：改用 `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`，失败才回退旧的 `SetProcessDPIAware()`。同一块屏，虚拟屏从 `3520×1280` 变成真实的 `3520×2560`。
- **实测**（1600×2560 @200% 竖屏 + 1920×1080 主屏）：`shot=3520×2560 virt=(-1600,0,3520,2560) dpiCtx=2`，遮罩与抓屏完整覆盖两块屏。

> Symptom: on a secondary portrait display the dimming overlay covered only the top half. Cause: `SetProcessDPIAware()` grants only *system*-DPI awareness, so a monitor whose scale differs from the system DPI gets its coordinates virtualized (1600×2560 @200% reported as 800×1280). Fix: per-monitor-aware V2, with the old call as fallback.

### 遮罩对比度 / 选框边界

- 未选区压暗浓度 43% → **62%**：白底窗口、视频等本来就很亮的画面不再"透过遮罩发亮"，看着像没被框到。
- 选区增加**深色描边 + 蓝色边框 + 实时尺寸标签**（`898 x 856`），边界一目了然。

### 选框健壮性

- 鼠标坐标统一钳制进画面范围再归一化，杜绝越界矩形画到窗口外或裁剪时抛异常。
- `MouseUp` 时重算一次矩形；4×4 像素以内不算框选（原来会把抖动的一次点击当成有效选区）。

## ✨ 改进 / Improvements

- **按钮风格统一**：截图按钮改为与 composer 左侧「+」「添加文件」完全相同的底板 —— DSH 原生 `.add` 规格：28×28 圆形、无边框、`background: var(--dsw-specific-selector)`，图标 14px，跟随主题换肤自动变化。
- **悬浮才降底板透明度**：默认实心圆底板，hover 时底板换成 `--dsw-alias-interactive-bg-hover-solid` 并把整体 opacity 降到 0.72，active 0.55，另加 `:focus-visible` 描边（键盘可达性）。

  The trigger now reuses DSH's own `.add` chrome and design tokens (28×28 circle, theme-aware), and only lowers the backplate opacity on hover / active.

## 🔧 诊断 / Diagnostics

- `GET /api/dsh-screen-snap/diag` 返回 `build` 标记 —— 一眼看出运行中的宿主进程加载的是哪一版模块（插件代码是启动时读进内存的，改完磁盘不重启不会生效，这个坑很隐蔽）。
- 每次框选把 `virt`（虚拟屏原点+尺寸）、`form`（窗口客户区）、`dpiCtx`、`dpiAware`、`selW/selH` 写进 `state.lastGeom`，并落盘到 `.diag/screen-snap.log`。
- 单飞锁 + 断线释放、150 秒窗口看门狗、PNG 魔数校验（沿用 1.2.0）。

## 📦 安装 / Install

```bash
# 目录放到 ~/.dsh/plugins/dsh-client-screen-snap/
# 在 ~/.dsh/profiles/web/package.json 里加：
#   dependencies:    "dsh-client-screen-snap": "link://<绝对路径>"
#   dsh.profile.bundles: "dsh-client-screen-snap"
pnpm install
# 重启 DSH Web，并刷新页面
```

> ⚠️ 宿主脚本与客户端 bundle 都是**启动时读入内存**：改完插件必须重启 DSH Web 服务再刷新页面才会生效。

## 🙏 反馈 / Credits

多显示器 DPI 这个 bug 由用户实测截图定位（1600×2560 竖屏副屏 + 1920×1080 主屏），本版已修复并加入几何诊断字段，便于后续同类问题一次性归因。
