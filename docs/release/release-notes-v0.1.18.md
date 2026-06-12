## 中文版本说明

这是 Hosts Switch 的 macOS 预发布构建，用于验证 Tauri + React 版 hosts 切换工具。`v0.1.18` 基于 `v0.1.17` 继续补强空 `/etc/hosts` 场景下的防误写保护、状态栏切换失败态、手工验收记录和菜单栏工具窗口行为。

本版本重点：

- 支持 macOS 状态栏菜单直接切换 hosts 节点，并支持按分组停用全部节点。
- 状态栏节点选择改为幂等操作：再次选择已激活节点会保持当前状态，不会再次触发 `/etc/hosts` 写入；需要停用分组时使用 No Active Node。
- 状态栏切换菜单对中文、冒号和其他 Unicode 配置 ID 使用 UTF-8 安全解析。
- 如果状态栏菜单项对应的 group/node 已经过期，会提示刷新菜单后重试，不再把过期点击静默当作成功。
- 如果状态栏无法加载原生 profiles 存储，会显示禁用的 `Profiles unavailable` 错误项，并保留 Refresh Menu、Open Editor 和 Quit，不再静默回退到默认示例 profiles。
- 如果当前 `/etc/hosts` 异常为空，编辑器会禁用 Apply，并在状态区域显示 `Hosts blocked`，避免用户在可疑系统 hosts 基线上继续写入。
- 关闭主编辑器窗口时会隐藏窗口而不是销毁窗口，状态栏图标可以继续重新打开编辑器。
- 原生 profiles 存储损坏时会优先从最近 profiles 备份恢复；如果没有可用备份，会保留 `profiles.json.corrupt-*` 副本后重建默认配置，避免状态栏应用无法继续打开。
- 保存、导入、从 `/etc/hosts` 恢复 profiles 前会自动保存上一份 profiles，并提供“恢复最近 profiles 备份”的确认操作。
- 使用 Hosts Switch managed block 写入 `/etc/hosts`，保留块外原有内容。
- Apply 和状态栏切换共用同一条管理员授权写入路径，写入成功后才保存激活状态。
- 启用 hosts 内容校验，非法 IP/hostname 会在 Apply 或状态栏切换写入前被拦截。
- 支持 JSON 配置导入/导出、登录项开关、全局快捷键打开编辑器、最近 hosts 备份恢复。
- 当当前 `/etc/hosts`、最近 hosts 备份或系统 hosts 状态异常为空时，默认阻止应用/恢复，避免把异常空 hosts 状态写回系统。
- 手动验证准备脚本默认拒绝为空的 `/etc/hosts` 写备份，避免把异常初始状态作为验收基线。
- 手工验收结果记录脚本现在与 checklist 保持 `profiles-backup-restore` 项同步，`npm run record:manual-result -- --help` 会列出可记录的 check IDs，减少真实 packaged-app 验收时漏记证据。
- Release workflow 会挂载 DMG 并校验其中的 `Hosts Switch.app` 元数据和 arm64 可执行文件。
- GitHub Release notes 继续从仓库内受校验的 `docs/release/release-notes-v0.1.18.md` 渲染发布，减少发布页面和源码记录不一致。
- 恢复最近 hosts 备份、恢复最近 profiles 备份、导入/恢复配置替换当前 profiles、删除分组/节点前都会先弹出确认；取消操作不会继续修改系统 hosts 或当前草稿。

使用前请注意：

- 该 DMG 未签名、未公证，首次打开可能需要在 macOS 安全设置中确认。
- 真实 `/etc/hosts` 管理员写入、状态栏切换授权/取消回滚、登录项、全局快捷键、备份恢复仍需按仓库中的 manual validation checklist 在真实 macOS 会话中验证。

## English Summary

Automated prerelease build for v0.1.18.

Artifact:

- Hosts.Switch_0.1.18_aarch64.dmg
- SHA-256: `add4c1daddafecf2552252a92aa0d289c1eca0509135ee11763464af3089463e`

Notes:

- This DMG is unsigned and not notarized.
- Real `/etc/hosts` administrator-write flows still require manual packaged-app validation before promoting to a production release.
