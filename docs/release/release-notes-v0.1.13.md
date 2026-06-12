## 中文版本说明

这是 Hosts Switch 的 macOS 预发布构建，用于验证 Tauri + React 版 hosts 切换工具。`v0.1.13` 基于 `v0.1.12` 继续收口状态栏 hosts 切换、危险操作确认和发布说明自动化。

本版本重点：

- 支持 macOS 状态栏菜单直接切换 hosts 节点，并支持按分组停用全部节点。
- 使用 Hosts Switch managed block 写入 `/etc/hosts`，保留块外原有内容。
- Apply 和状态栏切换共用同一条管理员授权写入路径，写入成功后才保存激活状态。
- 启用 hosts 内容校验，非法 IP/hostname 会在 Apply 或状态栏切换写入前被拦截。
- 支持 JSON 配置导入/导出、登录项开关、全局快捷键打开编辑器、最近 hosts 备份恢复。
- 当当前 `/etc/hosts` 或最近备份为空时，默认阻止应用/恢复，避免把异常空 hosts 状态写回系统。
- 手动验证准备脚本默认拒绝为空的 `/etc/hosts` 写备份，避免把异常初始状态作为验收基线。
- Release workflow 会挂载 DMG 并校验其中的 `Hosts Switch.app` 元数据和 arm64 可执行文件。
- GitHub Release notes 现在从仓库内受校验的 `docs/release/release-notes-v0.1.13.md` 渲染发布，减少发布页面和源码记录不一致。
- 恢复最近 hosts 备份、导入/恢复配置替换当前 profiles、删除分组/节点前都会先弹出确认；取消操作不会继续修改系统 hosts 或当前草稿。

使用前请注意：

- 该 DMG 未签名、未公证，首次打开可能需要在 macOS 安全设置中确认。
- 真实 `/etc/hosts` 管理员写入、状态栏切换授权/取消回滚、登录项、全局快捷键、备份恢复仍需按仓库中的 manual validation checklist 在真实 macOS 会话中验证。

## English Summary

Automated prerelease build for v0.1.13.

Artifact:

- Hosts.Switch_0.1.13_aarch64.dmg
- SHA-256: `999ce167e68d63cb90575f0e7673cb8e190d2698d7acd820a3765985dbd17c6b`

Notes:

- This DMG is unsigned and not notarized.
- Real `/etc/hosts` administrator-write flows still require manual packaged-app validation before promoting to a production release.
