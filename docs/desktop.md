# 桌面开发与发布 / Desktop development and releases

桌面版使用 Electron 内置运行时与本地 Next.js 服务，无需安装 Node.js 或联网，保留中文、英文界面。应用名称跟随系统首选语言：中文显示「萌芽」，其他语言显示「PetBloom」；Mac 应用显示名称、窗口与菜单，以及 Windows 安装器和快捷方式均已本地化。安装包文件名、程序文件名和数据目录固定使用 PetBloom，避免切换语言后产生重复安装或丢失原有数据。安装包不会带入开发数据库、会话、账号或 `.env`。首次使用需在本机注册教师账号。

| 平台 | 构建命令 | 产物（`dist/`） |
| --- | --- | --- |
| Mac Apple Silicon（M 系列） | `pnpm desktop:build:mac:arm64` | `PetBloom-0.0.1-mac-arm64.dmg`、`.zip` |
| Mac Intel | `pnpm desktop:build:mac:x64` | `PetBloom-0.0.1-mac-x64.dmg`、`.zip` |
| Windows x64 | `pnpm desktop:build:win` | `PetBloom-0.0.1-win-x64.exe` |

在 macOS 上运行 `pnpm desktop:build:mac` 可依次构建两种芯片。Windows 正式版在 Windows x64 构建；需要 Node.js 22.13+、pnpm 11、Python 3 和 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载。macOS 也可运行 `pnpm desktop:build:win` 交叉构建未签名的 Windows x64 预览包：使用 SQLite 自带的 Windows Node-API 模块，不跨系统运行 node-gyp；正式签名构建、Windows 开发模式及真实窗口回归仍须在 Windows 执行，不能把交叉打包成功当作实机验收通过。Mac 需要 Xcode Command Line Tools。先运行 `pnpm install --frozen-lockfile`；构建会下载 Electron 与原生依赖，需要网络。`pnpm desktop:dev` 可在当前系统打开桌面应用。桌面构建使用独立 `.next-desktop/` 和 `.desktop/`，不会覆盖 `.next/` 或改写 Web 环境的 SQLite 二进制。若有应用正从旧输出目录运行，可设置 `DESKTOP_OUTPUT_DIR` 在其他目录构建，避免覆盖正在使用的程序。

自动构建：将流程推送至默认分支后，在 GitHub 的 **Actions → 桌面安装包 → Run workflow** 手动运行。默认不勾选 `publish`，仅生成预览包并保存 Artifacts（14 天），不上传公开仓库。流程会汇总安装包与更新清单并校验 SHA-512；Mac Intel 和 Windows 还会实际启动窗口，检查注册、备份、导入、重启持久化和端口冲突恢复。Mac arm64 在 Intel runner 交叉构建，本地 Apple Silicon 另行验证。

桌面回归：先构建当前架构，再运行 `pnpm desktop:test`，或传入打包后的可执行文件路径，例如 `pnpm desktop:test dist/mac-arm64/PetBloom.app/Contents/MacOS/PetBloom`。测试使用 `.desktop/smoke-*` 的隔离数据，不读取或覆盖真实账号。Mac 在可执行文件路径后追加 `--mac-update`，可用本地 ZIP 副本测试覆盖、重启及数据保留；只对一次性副本加入调试入口和 ad-hoc 签名，不包含 GitHub 网络下载及管理员授权验收，也不会绕过 Gatekeeper。

- Mac：打开对应芯片的 DMG，把 PetBloom 拖到 Applications。
- Windows：打开 EXE，选择安装目录；支持桌面和开始菜单快捷方式，不需要管理员权限。
- 数据目录：Mac 为 `~/Library/Application Support/PetBloom/`；Windows 为 `%APPDATA%/PetBloom/`。菜单「文件 → 打开数据文件夹」可定位数据库、`desktop.json` 和启动日志 `desktop.log`。升级及正常卸载均保留数据；请定期在应用内导出 JSON 备份。
- 桌面服务仅监听 `127.0.0.1`，仅接受当前桌面窗口持有的随机令牌；渲染页面没有 Node.js 权限。退出应用时关闭本地服务。端口会保存在本机配置中；被占用时自动换用可用端口（界面偏好可能重置，数据库与账号不丢失）。
- **本地离线版不自动同步**：网页账号和服务器数据不会自动出现在桌面版。可通过现有 JSON 备份导入为班级副本；邀请码只适用于同一个数据库，不能跨电脑共享班级。
- 本地构建始终不上传安装包。公开分发前须确认宠物素材的再分发授权；Mac 可选 Apple 开发者签名与公证，Windows 正式构建仍需签名。签名凭据只放在构建环境，不写入仓库。

### 桌面检查更新与发布

更新源固定为公开仓库 [anthonyli/class-pet 的 Releases](https://github.com/anthonyli/class-pet/releases)，源码见本仓库。安装版启动十秒后后台检查，也可选择「文件 → 检查更新」。发现新版本先询问是否下载，菜单与 Dock/任务栏显示进度；下载完成后再次询问是否重启安装。「稍后」不会在普通退出时自动安装，可再次检查继续。离线检查失败不打扰日常使用，手动检查会提示重试；也可通过「文件 → 下载最新安装包」覆盖安装。Mac 使用独立更新辅助程序，不依赖 Squirrel 或 Apple 开发者证书：验证 ZIP 的 SHA-512、应用标识、版本和芯片后，停止本地服务、退出旧版后先保存 SQLite 与 WAL 的一致性冷快照，再在同一安装目录暂存并替换；只有新版窗口和本地服务准备就绪才清理旧版与快照，启动失败则尝试恢复原版及其数据库。权限不足时通过系统对话框请求管理员授权，Gatekeeper 安全确认正常保留，不移除 quarantine、不关闭安全检查。Windows 保留原有 NSIS 更新方式。账号与班级数据保留，升级前仍建议导出备份。

正式发布准备：

1. 公开更新仓库须已初始化至少一个提交，只存分发资产，不上传源码、数据库或测试资料。
2. 在**源码仓库**的 Actions Secrets 配置：
   - `RELEASE_TOKEN`：fine-grained GitHub Token，仅允许 `anthonyli/class-pet` 的 **Contents: Read and write**，只供发布任务使用，绝不进入安装包。
   - `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`：可选，Developer ID Application 证书（含私钥的 Base64 P12）及其密码；不配置时使用无需苹果账号的 ad-hoc 本地签名，不作为开发者身份认证。
   - `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：仅使用上述 Apple 证书正式分发时必需的公证凭据。
   - `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`：Windows 代码签名证书（含私钥的 Base64 P12/PFX）及其密码。需要硬件或云端签名的证书应先调整签名集成，不能直接假设可导出 PFX。
3. 提升 `package.json.version`（当前 `0.0.1`，下次例如 `0.0.2`），使用稳定的三段版本号，不复用已发布版本。手动从默认分支运行 workflow，勾选 `publish`；Windows 签名、可选的 Mac 开发者签名及公证、三个目标构建及回归、资产哈希校验全部成功后，流程在公开仓库创建 draft Release，完整上传后才公开并设为 Latest。已有同版本 Release 不覆盖；失败留下的 draft 需人工检查处理。
4. Mac 同时发布两种架构的 DMG **和 ZIP**，以及合并后的 `latest-mac.yml`；Windows 发布 EXE、`latest.yml`，并带上生成的 `.blockmap`。ZIP 是 Mac 自动更新必需资产，不能只上传 DMG，也不能让两个架构各自覆盖 `latest-mac.yml`。

本地正式构建追加 `--release`；Windows 必须配置代码签名，Mac 不要求 Apple 证书。若选择 Mac 开发者签名，则通过 `CSC_LINK`、`CSC_KEY_PASSWORD` 传入证书并配置上述 Apple 公证凭据。分别下载的三个 Actions Artifacts 保持 `PetBloom-mac-arm64/`、`PetBloom-mac-x64/`、`PetBloom-win-x64/` 目录，可用 `pnpm desktop:release:prepare <输入目录> <空输出目录> <版本号>` 仅在本地汇总和校验，不会上传。

**Mac 自更新不要求 Apple 开发者账号，但不保证所有版本只授权一次。** 安装目录权限和 Gatekeeper 可能要求用户确认；需要授权时只提权执行文件操作，不以管理员身份启动新版，也不安装常驻高权限服务；受保护目录的旧版清理或失败恢复可能再次请求授权。从 DMG 或 App Translocation 路径运行时，应先把应用移入 Applications。此前使用 Squirrel 的旧预览版需先手动覆盖安装一次新版更新器。检查和准备详情见 `desktop.log`，覆盖安装及回滚失败记录于数据目录的 `update.log`，保留旧版备份供恢复；需要在 Windows、Intel Mac、Apple Silicon 上做实际跨版本升级、系统授权与数据保留验收。GitHub 网络不可用时可继续离线使用，稍后重试。


---

### Desktop installers

The Electron desktop edition runs the complete app offline, with its own Node.js runtime and local SQLite database. The display name follows the system’s preferred language: **萌芽** for Chinese and **PetBloom** otherwise, including Mac application labels, native windows and menus, and Windows installer/shortcut names. Installer filenames, executable filenames and the data directory stay under PetBloom so language changes do not create duplicate installations or lose data. End users do not need Node.js. Build on macOS using `pnpm desktop:build:mac` (Apple Silicon and Intel), or use `pnpm desktop:build:win` on Windows x64 for native builds. The Windows command also cross-builds unsigned x64 previews on macOS using SQLite’s bundled Windows Node-API binary, without cross-OS node-gyp compilation. Signed Windows releases, Windows development launches and real GUI regression tests still require Windows; cross-packaging alone does not prove that installation and runtime work. Install dependencies first with `pnpm install --frozen-lockfile`; native compilation requires Xcode Command Line Tools on Mac, or Python 3 and the Visual Studio C++ desktop build tools on Windows. Building requires network access. Installers are generated in `dist/`; `pnpm desktop:dev` launches the desktop edition locally. Set `DESKTOP_OUTPUT_DIR` to build elsewhere if an app is still running from an older output directory, rather than overwriting its files.

Data lives in `~/Library/Application Support/PetBloom/` on Mac or `%APPDATA%/PetBloom/` on Windows; use **File → Open data folder** to find it. Upgrades and normal uninstallation preserve data. Development uses a separate `PetBloom Development` directory. No development database, session, account or environment secrets are bundled. Register a local account, export backups regularly, and use JSON imports to copy classes from another installation. There is no automatic sync; invitations cannot share classes across computers. The service listens only on loopback and requires a per-launch desktop token. A port conflict selects a new port; display preferences may reset, but accounts and class data remain intact.

After these changes reach the default branch, run **Actions → 桌面安装包 → Run workflow**. Leave `publish` unchecked for unsigned previews saved as Artifacts for 14 days, with no public upload. All three jobs must succeed before the asset collector verifies SHA-512 hashes and merges the Mac update manifests. Windows and Intel Mac jobs also launch the packaged app to check registration, backups, imports, persistence and port-conflict recovery. Apple Silicon is cross-built on the Intel runner and can be smoke-tested locally. Run `pnpm desktop:test`, optionally with the packaged executable path; tests use isolated `.desktop/smoke-*` profiles. On Mac, append `--mac-update` after the packaged executable path to test a local fixture ZIP through replacement, relaunch and data retention. Only disposable copies receive test instrumentation and ad-hoc signing. This does not test GitHub network downloads, administrator authorization or all Gatekeeper configurations; system security approval remains enabled.

### Desktop updates and releases

The public update source is [anthonyli/class-pet Releases](https://github.com/anthonyli/class-pet/releases); the source code is available in this repository. Installed builds check quietly ten seconds after startup; **File → Check for updates** also checks manually. A new version requires confirmation before downloading, displays menu and Dock/taskbar progress, and requires a second confirmation before restarting to install. **Later** prevents installation on normal quit; check again to continue. Offline checks never block existing features. Manual failures offer retry or **File → Download latest installer**. Mac uses an independent installer rather than Squirrel and does not require an Apple developer certificate: it verifies the ZIP’s SHA-512, bundle identity, version and architecture, stops the local service, quits, stages beside the installed app and replaces it. The previous app and a cold SQLite/WAL snapshot remain until the new local service and window are ready; failed startup attempts restore the app and database snapshot. Permission failures request administrator authorization through macOS, only for filesystem operations, never to run downloaded code as root. Gatekeeper and quarantine remain enabled. Windows keeps NSIS updating. Export a backup before upgrading.

For official releases:

1. Initialize the public repository with at least one commit. It hosts release assets only, not private source, databases or test profiles.
2. Configure these Actions Secrets in the **source repository**:
   - `RELEASE_TOKEN`: a fine-grained token restricted to **Contents: Read and write** for `anthonyli/class-pet`, available only to the publishing job and never bundled in the client.
   - `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`: optional Base64 P12 containing a Developer ID Application certificate and private key, plus its password. Without them, builds use local ad-hoc signing, requiring no Apple account and providing no developer identity authentication.
   - `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`: notarization credentials, required only when distributing with that Apple developer certificate.
   - `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`: Base64 P12/PFX code-signing certificate and private key, plus its password. Hardware-backed or cloud signing requires a separate signing integration; do not assume the key is exportable.
3. Increase the stable three-part `package.json.version` (currently `0.0.1`; for example, use `0.0.2` next). Never reuse a published version. Run the workflow from the default branch with `publish` checked. Windows signing, optional Mac developer signing and notarization, all builds, regression tests and hash validation must pass. The final job creates a draft Release, uploads all assets, then publishes it as Latest. Existing releases are not overwritten; inspect failed drafts manually.
4. Include both Mac DMGs **and ZIPs**, merged `latest-mac.yml`, the Windows EXE and `latest.yml`, plus generated `.blockmap` files. Mac updating requires ZIPs, and separate architecture manifests must not overwrite each other.

Local builds never upload. Add `--release` for a stable release build: Windows requires `CSC_LINK` and `CSC_KEY_PASSWORD`; Mac does not require an Apple certificate. If a Mac developer certificate is supplied, Apple notarization credentials are also required. To collect downloaded artifacts locally, preserve the `PetBloom-mac-arm64/`, `PetBloom-mac-x64/` and `PetBloom-win-x64/` folders and run `pnpm desktop:release:prepare <input-directory> <empty-output-directory> <version>`.

**Mac self-updates do not require an Apple developer account, but cannot promise one-time-only authorization.** Directory permissions or Gatekeeper may require confirmation for subsequent versions; cleanup or recovery in protected directories may request authorization again. No persistent privileged service is installed and no security checks are disabled. Move the app to Applications before updating if it is running from a DMG or App Translocation. Old Squirrel-based previews need one manual installation of this updater first. Check and preparation details are recorded in `desktop.log`; replacement and recovery failures are recorded in `update.log` in the data directory, with old files retained for recovery. Complete real cross-version upgrade, administrator authorization and data-retention testing on all three targets. GitHub connectivity failures leave the offline app usable. Confirm pet artwork redistribution permission before publishing, and keep signing credentials outside the repository.

