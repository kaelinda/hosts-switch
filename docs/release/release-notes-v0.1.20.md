## 中文版本说明

这是 Hosts Switch 的 macOS 预发布构建，用于验证 Tauri + React 版 hosts 切换工具。`v0.1.20` 基于 `v0.1.19` 增强空 `/etc/hosts` 场景下的恢复指引，让安装包内的界面也能直接指导用户先恢复安全基线。

本版本重点：

- 当当前 `/etc/hosts` 是空文件时，编辑器会在警告下方显示推荐的默认 macOS hosts 内容。
- 同一空 hosts 面板会显示手动恢复命令，包括先备份空文件、写入默认 hosts、恢复权限并刷新 DNS 缓存；这些命令只展示在界面里，app 不会自动执行系统修改。
- 空 `/etc/hosts` 时 Apply 仍然禁用，状态区域继续显示 `Hosts blocked`，避免在异常系统基线上继续写入。
- macOS 顶部状态栏入口显式使用打包内置 app icon，安装后可从菜单栏打开切换菜单。
- 双击打开本地 app 后会直接显示编辑器窗口；关闭窗口后仍会隐藏到状态栏，状态栏图标可重新打开编辑器。
- 支持 macOS 状态栏菜单直接切换 hosts 节点，并支持按分组停用全部节点。
- 状态栏节点选择改为幂等操作：再次选择已激活节点会保持当前状态，不会再次触发 `/etc/hosts` 写入；需要停用分组时使用 No Active Node。
- 状态栏切换菜单对中文、冒号和其他 Unicode 配置 ID 使用 UTF-8 安全解析。
- 如果状态栏菜单项对应的 group/node 已经过期，会提示刷新菜单后重试，不再把过期点击静默当作成功。
- 如果状态栏无法加载原生 profiles 存储，会显示禁用的 `Profiles unavailable` 错误项，并保留 Refresh Menu、Open Editor 和 Quit，不再静默回退到默认示例 profiles。
- 使用 Hosts Switch managed block 写入 `/etc/hosts`，保留块外原有内容。
- Apply 和状态栏切换共用同一条管理员授权写入路径，写入成功后才保存激活状态。
- 启用 hosts 内容校验，非法 IP/hostname 会在 Apply 或状态栏切换写入前被拦截。
- 支持 JSON 配置导入/导出、登录项开关、全局快捷键打开编辑器、最近 hosts 备份恢复。
- 当当前 `/etc/hosts`、最近 hosts 备份或系统 hosts 状态异常为空时，默认阻止应用/恢复，避免把异常空 hosts 状态写回系统。
- Release workflow 会挂载 DMG 并校验其中的 `Hosts Switch.app` 元数据和 arm64 可执行文件。
- GitHub Release notes 继续从仓库内受校验的 `docs/release/release-notes-v0.1.20.md` 渲染发布，减少发布页面和源码记录不一致。

使用前请注意：

- 该 DMG 未签名、未公证，首次打开可能需要在 macOS 安全设置中确认。
- 真实 `/etc/hosts` 管理员写入、状态栏切换授权/取消回滚、登录项、全局快捷键、备份恢复仍需按仓库中的 manual validation checklist 在真实 macOS 会话中验证。
- 如果当前 `/etc/hosts` 是 0 bytes，请先按 app 内或 `npm run print:hosts-recovery` 输出的只读指南手动恢复默认 hosts 内容，再测试 Apply 或状态栏切换。

## English Summary

Automated prerelease build for v0.1.20.

Artifact:

- Hosts.Switch_0.1.20_aarch64.dmg
- SHA-256: pending until release publication

Notes:

- This DMG is unsigned and not notarized.
- Real `/etc/hosts` administrator-write flows still require manual packaged-app validation before promoting to a production release.
