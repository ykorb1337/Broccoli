# 安装与卸载

## 安装

从 [Broccoli Releases](https://github.com/ykorb1337/Broccoli/releases) 下载 DMG，打开 **Broccoli Installer**。应用安装到 `~/Applications/Broccoli.app`，当前用户后台随登录启动，无需另装 Python。

升级保留规则、锁定、额度、安全词、统计、截图及 Google 连接。旧 HotTurkey 应用在成功升级时替换为 Broccoli；内部标识与原有数据目录保持兼容。规则锁定时，普通更新仍需先解锁。

当前提供 Apple Silicon 预览包，尚无 Developer ID 签名和 Apple 公证。macOS 可能阻止首次打开。请核对来源和发行版 SHA-256；系统安全提示由用户自行处理。

网站拦截需要加载扩展并登记扩展 ID。发行版提供独立扩展 ZIP，应用内“浏览器与安装说明”列出步骤。验证范围见 [验证记录](VALIDATION.md)。

## 独立卸载工具

**Broccoli Uninstaller** 仅作为发行版中的单独 ZIP 附件提供。主安装包不含它，应用与安装器不会自动下载，也没有应用内下载入口。解压即可运行，无须先安装主应用。

- 普通生效或锁定规则不会单独阻止卸载，避免意外被困在限制中。
- 当前应用规则拦截卸载器，或锁定期间启用“拦截安装器”时，工具拒绝执行。复制或改名不会改变应用标识。
- 设置密码已开启时需要验证密码；密码不放入命令参数或日志。
- 卸载停止当前用户的界面、后台及采集程序，移除其登录启动与浏览器连接。
- 规则、统计、截图与 Google 配置保留，自选截图目录不删除。程序移至数据目录内的 `Uninstall Backups`；失败时恢复文件和先前运行的后台。

当前用户版不能阻止同权限用户直接修改文件，不提供系统级防篡改保证。实验性系统服务不由该工具管理。

## Build artifacts

```sh
python3 scripts/build.py --distribution
```

Produces a DMG containing **Broccoli Installer**, a separate **Broccoli Uninstaller** ZIP, a browser-extension ZIP, and `SHA256SUMS.txt` in `dist/`. Both tools include their runtime. User databases, screenshots, credentials and configurations are never packaged.
