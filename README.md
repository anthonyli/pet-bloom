# PetBloom · 萌芽

> 让每一份成长，都悄悄发芽。

PetBloom（萌芽）是面向学校和班级的游戏化宠物养成与学生成长激励平台。

独立的 Next.js 全栈应用，采用宠物卡片工作台。架构参考同级 `pageon`：Next.js App Router + React + Tailwind + 共享 UI；数据库使用 SQLite，不依赖原 Vue 项目或 PageOn 服务。

## 启动

要求 Node.js 22.13+、pnpm 11。

```bash
pnpm install
pnpm dev
```

- 中文：http://localhost:3100/zh
- English：http://localhost:3100/en
- 健康检查：http://localhost:3100/api/health

注册教师账号后会自动登录，须先补齐教师称呼、任教学科和教学身份；已有账号也须完成资料后才能操作班级。随后可以创建班级、凭其他教师的邀请码加入，或点击「体验演示班级」。不会自动把演示数据放进新账号。没有内置管理员或默认密码。

## 桌面安装包（Windows / macOS）

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

更新源固定为公开仓库 [anthonyli/class-pet 的 Releases](https://github.com/anthonyli/class-pet/releases)，源码仓库无需公开。安装版启动十秒后后台检查，也可选择「文件 → 检查更新」。发现新版本先询问是否下载，菜单与 Dock/任务栏显示进度；下载完成后再次询问是否重启安装。「稍后」不会在普通退出时自动安装，可再次检查继续。离线检查失败不打扰日常使用，手动检查会提示重试；也可通过「文件 → 下载最新安装包」覆盖安装。Mac 使用独立更新辅助程序，不依赖 Squirrel 或 Apple 开发者证书：验证 ZIP 的 SHA-512、应用标识、版本和芯片后，停止本地服务、退出旧版后先保存 SQLite 与 WAL 的一致性冷快照，再在同一安装目录暂存并替换；只有新版窗口和本地服务准备就绪才清理旧版与快照，启动失败则尝试恢复原版及其数据库。权限不足时通过系统对话框请求管理员授权，Gatekeeper 安全确认正常保留，不移除 quarantine、不关闭安全检查。Windows 保留原有 NSIS 更新方式。账号与班级数据保留，升级前仍建议导出备份。

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

## 已实现功能

- 注册、登录、退出，HttpOnly 会话 Cookie，口令使用 scrypt 哈希；教师资料可随时编辑，教学身份仅用于介绍，不直接授予班级权限。
- 班级创建、改名、切换；学生添加、编辑、删除、批量文本导入。班级默认私有，只向负责人和已加入的共同管理员开放。
- 班级教师可生成、复制或停用邀请码；邀请码为 6 组 4 位十六进制字符，7 天内可多人使用，仅生成时展示明文。新码替换旧码；加入前先预览班级并确认，已有班级的教师也可以继续加入其他班级。
- 共同管理员可管理班级名称、学生、评价、兑换、规则、成长设置、商店及邀请；仅负责人可删除班级、移除成员、转让负责人及导出该班备份。共同管理员可退出，负责人须先转让；转让给已加入教师后原负责人保留共同管理员身份。移除或转让会使旧邀请码失效，不删除历史记录。
- 50 种完整八阶段宠物，分为精灵系 2、山海系 6、动画系 1、萌宠系 41（含新增鼠、牛、蛇）。
- 共 400 张 WebP，每只宠物八张文件内容均不同，不能把一张图重复当作不同阶段。
- 十二生肖专题已补齐 12 种，包含新增鼠、牛、蛇的 24 张独立阶段图；图鉴预览与领养均已开放。
- 图鉴与领养共用分类目录；生肖按传统顺序排列。山海系为神话主题分类，不等同于严格的古籍出处索引。
- 每个教师账号注册时独立初始化 83 条完整中英文规则（45 条加分、38 条扣分）及个人初始模板；新建班级复制自己的模板。各班的规则、成长设置和商店（含库存）独立，修改只影响当前班级并由本班教师共享；自定义规则名称只需填写一次。
- 单人、批量评价；支持一次性自定义加分与扣分（非零整数，不设业务分值上限，保留安全整数校验），原因选填、最多 80 字，不新增规则；搜索、排序；成长、升级、与学生绑定的等级徽章收藏。
- 加分时对应宠物轻跳并飘出爱心、星星与分值；扣分时轻摇并显示减分。批量操作同时反馈，升级后衔接全屏光束、粒子与形态展示，支持逐位继续、Esc 关闭和减少动态效果。
- 下拉框、复选框、弹窗统一使用 Radix 组件；操作、分类和菜单统一使用 Lucide 图标，不调用系统原生下拉菜单。
- 累计积分排行榜，评价及兑换历史保留操作当时的教师称呼与学科，并显示撤回教师；改名、退出或移除不改写历史署名。旧记录无法证明操作者时显示为历史记录。负责人可撤回班内所有记录，共同管理员仅可撤回自己的评价整批或兑换，仍须满足原有周期与徽章余额限制。
- 徽章奖励商店，商品名称与描述各填写一次、分类图标或上传图片、库存、商品编辑、兑换与退款退库存。
- 41 种原创本地 SVG 宠物背景：4 种日常场景、22 种国内节日、15 种国际与海外节日，支持分类筛选和中英文名称、描述搜索。国庆以大红与五星红旗呈现，建军节突出「八一」与和平鸽，各节日保留自己的代表元素。在「小商店 → 宠物背景」分页为学生兑换，仅解锁、不自动更换；再去「装扮」筛选、预览、使用或恢复免费默认背景。节日背景不按日期自动更换；节日当天可按学校时区免费临时使用，不扣徽章、不产生兑换记录，到期恢复原长期背景或默认。已兑换背景全年可用。背景归学生持有，换宠、毕业后保留，已拥有的不重复扣费，下架后仍可选用；退款撤销持有，若正在使用则恢复默认背景。
- v7 JSON 备份仅包含本人当前负责的班级、各班资源和个人初始模板，不含仅共同管理的班级、账号凭据、成员权限或邀请码；保留历史教师署名，但不据此恢复账号关联或授权。支持导入 v1–v6 历史备份，先按各自原格式校验。已完善资料的教师均可导入，事务内创建新的班级副本，导入者为负责人，不覆盖现有班级、共管数据或个人初始模板，也不恢复其他教师权限；失败整体回滚。
- 中文/英文 URL 与切换，响应式桌面和手机界面，键盘可操作的 Radix Dialog。

## 架构

```text
浏览器 → Next.js 单个 Node.js 服务 → SQLite
          ├─ /zh、/en 页面
          ├─ /api/* Route Handlers
          ├─ components/ui 共享表单与弹窗
          └─ lib/server 账号、领域事务、备份恢复
```

- `app/[locale]/page.tsx`：双语页面入口。
- `app/api/[...path]/route.ts`：认证、来源校验、请求大小限制与 API 分发。
- `components/`：工作台、账号、管理、宠物、评价及商店界面。
- `lib/server/db.ts`：SQLite 连接、结构、WAL、外键。
- `lib/server/garden.ts`：教师资料、班级成员/负责人权限校验、邀请及业务事务。
- `lib/server/backup.ts`：v7 备份、历史格式校验、编号重映射与原子副本导入。
- `lib/data/`：宠物、默认规则及背景双语配置；41 种背景及其分类定义于 `lib/data/backgrounds.json`。
- `public/pets/`：本地宠物图片及来源清单。
- `public/pet-backgrounds/`：41 种原创本地 SVG 背景场景，来源记录在 `public/pets/SOURCES.md`。
- `tests/`：领域行为与真实 Route Handler 请求测试，不使用生产数据库。

共享 UI 是该项目内的独立实现，不通过相对路径耦合 `pageon` 的工作目录，也没有复制 PageOn 的环境变量或密钥。

## 数据与成长规则

默认数据库：**`data/pet-garden.db`**，路径相对于启动工作目录，也可通过 `DATABASE_PATH` 指定绝对路径。首次访问服务时自动建库。

默认每级新增经验 `[40, 60, 80, 100, 120, 140, 160]`，累计 700 达到 8 级，每级奖励一枚徽章。在「规则 → 成长设置」可分别调整当前班级的七段升级经验和奖励数量（允许 0 枚），不会修改其他班级或个人初始模板。保存后立即按原等级及本级完成比例换算经验，保留小数余量；已毕业宠物仍毕业，已获奖励不重定价、不追扣。普通扣分不收回里程碑，撤回后重新获得同一里程碑也沿用首次奖励额度，不能借改配置刷奖。毕业后重新领养开启新周期，累计积分和旧徽章保留。

「规则 → 宠物状态」可控制换宠、饥饿提醒、生病与蛋形态。新账号和旧账号迁移均默认保留原来的经验截零行为，提醒和负分形态默认关闭。启用生病或蛋形态后，后续评价保留负经验，不追溯改变旧评价；关闭形态只隐藏状态，不清空负债。负经验仍为 Lv.1。生病按 Lv.1 且卡片上的累计积分低于 0 判断，保存后立即生效，不要求本轮成长值为负；积分恢复到 0 后解除。若同时满足蛋形态条件，则优先显示蛋。蛋形态独立按卡片上的累计积分判断：积分达到设置的分数线（默认 -10）或更低时显示蛋，启用或调整后立即生效，不要求本轮成长值也达到该分数线。蛋是可恢复显示态，不删除宠物、积分、养成周期或徽章，累计积分高于分数线后恢复。

饥饿仅提醒，不自动扣分。起点为本轮领养或最近一次有效加分；扣分不喂养，撤回加分后重算。时长以学校时区（默认 Asia/Shanghai）计算，可排除周末和教师维护的学校假期日期范围，不自动联网识别法定节假日。迁移旧数据缺少领养时间时，以学生创建时间作为起点，已有有效加分会更新该起点。页面每分钟及重新获得焦点时刷新提醒。

撤回会按仍有效的完整记录重新计算，而不是简单减绝对值；徽章按有效记录中的历史最高成长重算。撤回批量评价会整批操作。重新领养后，已结束的旧周期不支持撤回；若撤回将收回已用于兑换的额度，须先退回相关兑换，避免徽章余额变成负数。

商品图片仅接受最大 2 MB 的 PNG/JPEG/WebP，服务端重新编码为最多 512px、256 KB 的 WebP；图片总量按每个班级或个人初始模板分别限制为 10 MB，不是全账号共用额度。图像存入 SQLite，并随 v7 备份导出和副本导入。库存 -1 表示无限；有限库存随兑换扣减，退款时恢复实际扣减的库存，各班库存互不影响。

背景目录 `lib/data/backgrounds.json` 当前有 41 项，含 `category`、中英文名称与描述：日常场景 4 项，国内节日 22 项，国际与海外节日 15 项。国内新增除夕、小年、龙抬头、冬至、植树节、青年节、建党节、建军节和中国农民丰收节；原有节日也强化了各自主题色和代表元素，而非统一浅色风景。全部背景初始各 1 枚徽章，库存固定 `stock=-1`（无限）；仅按班修改价格，允许 1–100 的整数，只影响当前班级之后的兑换，不改变其他班级、个人初始模板或已拥有背景。商店和装扮均可按分类及中英文名称、描述搜索筛选；默认背景始终免费；日常背景及节日以外的长期使用须为每位学生分别兑换，使用已拥有背景或恢复默认不再扣费。37种节日背景在对应节日按学校时区提供临时免费使用，不算永久拥有、不扣徽章、不写兑换记录；到期恢复原长期背景，没有则恢复默认，已兑换背景不受影响。节日不自动切换，教师仍需主动在装扮中选用。商品下架或零徽章不影响当天免费入口，4种日常背景不参加节日免费。

服务端通过离线历法规则判断学校日期（复用宠物状态设置中的学校时区，默认 `Asia/Shanghai`），不接受客户端传入的免费标记或日期。小年兼容腊月二十三、二十四；节日主日不扩展成调休假期；母亲节为5月第二个周日、父亲节为6月第三个周日、感恩节按美国11月第四个周四，复活节按西方日期；光明节为连续8个学校民用日。排灯节固定采用印度新德里 Lakshmi Puja 主日，已逐年核验2026–2030（[Drik Panchang](https://www.drikpanchang.com/festivals/lakshmipuja/festivals-lakshmipuja-timings.html?geoname-id=1261481)、[timeanddate India](https://www.timeanddate.com/holidays/india/diwali)），其他年份明确提示尚无可靠日期，不猜测开放。页面按服务端时刻安排独立到期清理，断网或保存挂起也不会无限保留免费装扮；改变学校时区会清除该班临时选择。

v4 已包含每班设置版本、成长事件及锁定奖励额度；其数据库迁移为旧班级复制原账号配置并保留成长与兑换历史。v5 增加背景商品、兑换快照和当前装备字段，固定初始化原 4 种背景；v6 固定只补原 28 种节日背景。v7 仅一次性向个人初始模板和既有班级补入9种国内节日。当前数据库为 v8，导出备份仍为 v7；v8 只追加临时免费装扮及截止时间，备份明确排除这两个临时字段，保留原长期背景。恢复后临时选择为空，当天免费资格重新由服务端判定。迁移不重建旧背景缺项、不重新上架已有下架商品，也不改动既有价格、持有或当前装备；迁移在事务中执行，失败回滚。背景拥有列表仍由未退款的有效兑换记录派生，不单独导出。

历史备份先按各自原格式校验；v5 的原 schema 及背景标识白名单冻结为原 4 种，v6 冻结为原 32 种，v7 为 41 种。所有版本导入都在事务中创建新的班级副本，不改动既有班级或个人初始模板：v1–v4 新副本初始化全部 41 种背景商品；v5 只补原 28 种节日与本轮 9 种国内节日，保留原 4 种的价格、下架状态及缺项；v6 只补本轮 9 种，保留原 32 种的现有状态；v7 按备份原样恢复商品，不补任何缺失项。

工作台历史展示当前班级最近 200 条记录，完整历史保留在 SQLite 和导出备份中。每次文本导入上限 500 名学生；备份恢复文件上限 50 MB。当前没有找回密码、邮件验证或管理后台，不要将教师密码复用到其他网站。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

开发和生产检查同时运行时，使用独立构建目录，避免覆盖开发缓存：

```bash
BUILD_DIR=.next-build pnpm build
BUILD_DIR=.next-build pnpm start
```

## Vercel + Turso（新加坡）

网站使用 Turso 托管 SQLite，Vercel Functions 固定在 `sin1`（新加坡）；Turso 主库位于 `aws-ap-southeast-1`。`vercel.json` 配置构建命令和区域。桌面版仍使用用户目录里的本地 SQLite。

部署前在 Vercel 的 **Production** 环境设置服务端变量 `TURSO_DATABASE_URL` 和 Secret 类型的 `TURSO_AUTH_TOKEN`。不要给变量添加 `NEXT_PUBLIC_` 前缀。Preview 必须单独配置测试数据库，不能复用生产令牌。Vercel 缺少数据库配置时会拒绝启动业务接口，避免将数据写入临时磁盘。

当前项目使用 `scripts/deploy-vercel.mjs` 一键发布到 **https://pet.pageon.cc**：

```bash
pnpm install --frozen-lockfile
pnpm dlx vercel@65.9.0 login # 首次使用，登录有项目权限的账号
turso auth login           # 首次使用，登录有数据库权限的账号
pnpm deploy:vercel --dry-run # 查看计划，不访问云端
pnpm deploy:check           # 校验云配置、数据库版本、类型和测试，不发布
pnpm db:check               # 单独检查数据库版本、历史和待执行迁移
pnpm db:migrate             # 单独执行：备份 → 演练 → 事务迁移
pnpm deploy:vercel          # 完整检查 → 待发布构建 → 数据迁移 → 切换生产 → 验证
```

脚本固定现有团队 `463968565-9701`、项目 `prj_emyFfVTcT3hNq3E5zhlPLq9zHt6O`、Vercel `sin1` 和新加坡 Turso 地址；本地链接或云端配置不匹配会停止。使用当前工作区文件部署，发布前请确认待发布修改。需要 Node.js ≥22.13、pnpm、curl 和已登录的 Turso CLI（本机验证版本为 1.0.34；可用 `TURSO_CLI` 指定路径）。Vercel 使用现有登录凭据，CI 可安全注入 `VERCEL_TOKEN`。迁移脚本通过 Turso CLI 生成有效期 1 天、限定当前数据库的临时令牌，只保留在内存；检查模式使用只读令牌，不读取应用的生产令牌。

正式发布先通过 `--prod --skip-domain` 构建待发布版本，构建成功后运行独立迁移脚本，迁移成功才 `promote` 切换生产域名。之后核对域名的部署 ID，并请求 `/api/health` 确认 Turso 可用。健康检查最多重试 6 次；验证失败返回非零退出码，已提交的兼容迁移会保留，脚本不会用旧备份自动覆盖数据库。测试进程会移除继承的数据库和 Vercel 环境变量。网络需要代理时，可使用标准代理环境变量，例如 `HTTPS_PROXY=http://127.0.0.1:7890 pnpm deploy:vercel`；脚本不会关闭 TLS 校验。

云迁移从现有 schema v8 接管，首次运行只登记基线，不重建业务表、不覆盖数据。迁移文件位于 `migrations/turso`，校验和、已执行版本记录在 `_pet_bloom_migrations`。有待执行迁移时，先导出包含账号、会话和全部业务表的完整快照到 `data/backups/turso/`，验证完整性和外键，并在快照上演练、逐表核对原有字段和记录；演练回滚后保留迁移前的 `snapshot.db`。云端使用单个写事务批次执行变更、核对行数并更新版本，任一步失败则整批回滚。备份目录已排除 Git 和 Vercel 上传。

自动迁移仅支持新增表、索引和兼容旧版写入的可空字段；删表、删字段、重命名、覆盖数据被拒绝。新增迁移、版本更新与恢复步骤见 [迁移说明](migrations/turso/README.md)。本地数据不会自动上传；本地 `PRAGMA user_version` 迁移不在云端运行。生产应通过此脚本发布；直接运行 `vercel deploy` 或 Vercel Git 自动部署会绕过迁移流程，不应作为数据库升级的发布入口。

Vercel 网页版单次备份导入/导出上限为 4 MB（平台请求/响应上限为 4.5 MB，预留开销）；桌面版和自托管版仍为 50 MB。较大的既有备份请继续使用桌面版，后续需接入对象存储才能提高网页版上限。

本地验证：`pnpm typecheck`、`pnpm test`、`BUILD_DIR=.next-build pnpm build`。真实云端集成测试仅在提供独立测试库的 `TURSO_TEST_DATABASE_URL` / `TURSO_TEST_AUTH_TOKEN` 时运行；测试会创建并清理临时数据，请勿使用生产库。

## 单服务器部署

```bash
pnpm install --frozen-lockfile
pnpm build
DATABASE_PATH=/srv/pet-garden/data/pet-garden.db \
COOKIE_SECURE=true APP_ORIGIN=https://your-domain.example pnpm start
```

通过 HTTPS 反向代理访问，允许的来源填写实际公开地址。`COOKIE_SECURE=true` 仅适用于 HTTPS；本机 HTTP 开发保持默认 `false`。Next 默认端口为 3100，生产按需通过进程管理器长期运行。

也可以用 Docker：

```bash
docker compose up --build -d
```

Compose 的 `garden-data` 卷保存 SQLite。不要删除该卷；更新代码或容器不应覆盖数据库。HTTPS 代理部署时在环境中设置 `COOKIE_SECURE=true` 和 `APP_ORIGIN`。

**以下本地 SQLite 模式需要持久化磁盘。** 不应把此配置原样部署到无持久卷的 Serverless/临时文件系统，也不支持多台服务器各自写一个独立数据库。多教师访问由服务端的班级成员与负责人权限校验控制，而不是每位教师创建一个 `.db` 文件。

运行中的库使用 WAL，不要只复制主 `.db` 文件做在线备份。优先使用应用的 JSON 导出，或使用 SQLite backup API；冷备份应先停止服务并处理 WAL。备份包含学生信息，应妥善保管并定期复制到其他安全位置。

## 第三方资源

宠物基础图片及原始规则为第三方导入资源。原 47 种全部 376 张图片已解码校验，本地路径及 SHA-256 记录在 `public/pets/image-manifest.csv` 中，素材说明详见 `public/pets/SOURCES.md`。

生肖鼠、牛、蛇已由 Codex 原生图片工具生成各 8 张独立阶段图，并注册为可领养宠物；状态清单见 `lib/data/zodiac-plan.json`。生成提示词、参考图、阶段文件及导出校验见 `public/pets/zodiac-generation-manifest.json`。原生工具未披露实际模型，因此不标称使用某个指定模型。之前尝试的不同画风单图方案已撤下，不进入发布资源。

英文宠物名、分类与规则文案是本项目添加的翻译。

`public/pet-backgrounds/` 的 41 种场景 SVG（4 种日常、22 种国内节日、15 种国际与海外节日）是本项目原创矢量背景，不来自第三方站点，也不替换原有宠物图片；完整目录与来源说明记录在既有 `public/pets/SOURCES.md`。

**公开可下载不代表获得商业使用或再分发许可。公开部署前请确认资源授权，或替换为已授权图片。** 此项目没有复制第三方站点的运行脚本，也不依赖其在线服务。

---

## English

**PetBloom · 萌芽** is a gamified pet-raising and student growth motivation platform for schools and classrooms.

> Let every bit of growth quietly bloom.

A standalone bilingual app using Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Radix Dialog and SQLite. Pages and API routes run in one Node.js service, following the architecture of the adjacent PageOn project without depending on it.

### Run

Node.js 22.13+ and pnpm 11 are required. Run `pnpm install` and `pnpm dev`, then open http://localhost:3100/en. Registration signs you in automatically. Complete your teacher name, subject and teaching role before creating a class, joining with an invitation code or choosing **Try a demo class**. Existing accounts must also complete their profiles. Demo data is never added automatically. There is no built-in account or default password.

### Desktop installers

The Electron desktop edition runs the complete app offline, with its own Node.js runtime and local SQLite database. The display name follows the system’s preferred language: **萌芽** for Chinese and **PetBloom** otherwise, including Mac application labels, native windows and menus, and Windows installer/shortcut names. Installer filenames, executable filenames and the data directory stay under PetBloom so language changes do not create duplicate installations or lose data. End users do not need Node.js. Build on macOS using `pnpm desktop:build:mac` (Apple Silicon and Intel), or use `pnpm desktop:build:win` on Windows x64 for native builds. The Windows command also cross-builds unsigned x64 previews on macOS using SQLite’s bundled Windows Node-API binary, without cross-OS node-gyp compilation. Signed Windows releases, Windows development launches and real GUI regression tests still require Windows; cross-packaging alone does not prove that installation and runtime work. Install dependencies first with `pnpm install --frozen-lockfile`; native compilation requires Xcode Command Line Tools on Mac, or Python 3 and the Visual Studio C++ desktop build tools on Windows. Building requires network access. Installers are generated in `dist/`; `pnpm desktop:dev` launches the desktop edition locally. Set `DESKTOP_OUTPUT_DIR` to build elsewhere if an app is still running from an older output directory, rather than overwriting its files.

Data lives in `~/Library/Application Support/PetBloom/` on Mac or `%APPDATA%/PetBloom/` on Windows; use **File → Open data folder** to find it. Upgrades and normal uninstallation preserve data. Development uses a separate `PetBloom Development` directory. No development database, session, account or environment secrets are bundled. Register a local account, export backups regularly, and use JSON imports to copy classes from another installation. There is no automatic sync; invitations cannot share classes across computers. The service listens only on loopback and requires a per-launch desktop token. A port conflict selects a new port; display preferences may reset, but accounts and class data remain intact.

After these changes reach the default branch, run **Actions → 桌面安装包 → Run workflow**. Leave `publish` unchecked for unsigned previews saved as Artifacts for 14 days, with no public upload. All three jobs must succeed before the asset collector verifies SHA-512 hashes and merges the Mac update manifests. Windows and Intel Mac jobs also launch the packaged app to check registration, backups, imports, persistence and port-conflict recovery. Apple Silicon is cross-built on the Intel runner and can be smoke-tested locally. Run `pnpm desktop:test`, optionally with the packaged executable path; tests use isolated `.desktop/smoke-*` profiles. On Mac, append `--mac-update` after the packaged executable path to test a local fixture ZIP through replacement, relaunch and data retention. Only disposable copies receive test instrumentation and ad-hoc signing. This does not test GitHub network downloads, administrator authorization or all Gatekeeper configurations; system security approval remains enabled.

### Desktop updates and releases

The public update source is [anthonyli/class-pet Releases](https://github.com/anthonyli/class-pet/releases); the source repository can remain private. Installed builds check quietly ten seconds after startup; **File → Check for updates** also checks manually. A new version requires confirmation before downloading, displays menu and Dock/taskbar progress, and requires a second confirmation before restarting to install. **Later** prevents installation on normal quit; check again to continue. Offline checks never block existing features. Manual failures offer retry or **File → Download latest installer**. Mac uses an independent installer rather than Squirrel and does not require an Apple developer certificate: it verifies the ZIP’s SHA-512, bundle identity, version and architecture, stops the local service, quits, stages beside the installed app and replaces it. The previous app and a cold SQLite/WAL snapshot remain until the new local service and window are ready; failed startup attempts restore the app and database snapshot. Permission failures request administrator authorization through macOS, only for filesystem operations, never to run downloaded code as root. Gatekeeper and quarantine remain enabled. Windows keeps NSIS updating. Export a backup before upgrading.

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

### Features

Teacher accounts with editable profiles; private-by-default classes shared with invited co-admins; class and student management; bulk text import; 50 companions across Fairy, Shanhai, Animation and Cute Companions, including all twelve zodiac signs. All 400 growth images are available, with 8 distinct files per pet. Rat, Ox and Snake have 24 newly generated evolution images and are registered for adoption; no repeated single-image placeholders are shipped. Each account starts with its own template and 83 bilingual evaluation rules. New classes copy that template; each class then has independent rules, growth settings, shop items and stock. Other features include custom rules; one-off custom bonuses and deductions with non-zero whole scores, no business score cap, safe-integer validation and an optional reason of up to 80 characters, without creating a rule; batch evaluation; sorting and search; honor roll; transactional undo; student-owned level badges; and a reward shop with single-entry names and descriptions, category icons or uploaded images, editable stock, redemptions and returns. Both interface and default pet/rule names are localized. User-entered names are preserved as entered.

The original local SVG background catalog in `lib/data/backgrounds.json` now has 41 entries: four everyday scenes, 22 Chinese holidays and 15 international or overseas holidays. Nine Chinese additions cover Lunar New Year’s Eve, Little New Year, Dragon Head-raising Day, Winter Solstice, Arbor Day, Youth Day, CPC Founding Day, Army Day and the Chinese Farmers’ Harvest Festival. Each scene emphasizes recognizable colors and motifs, such as a vivid red National Day scene with the five-star red flag, and August First lettering with peace doves for Army Day. Each entry has a category and bilingual names and descriptions. Both the shop and Dress up support category filters and Chinese or English name/description searches. All backgrounds initially cost one badge each, with stock fixed at `-1` (unlimited). Prices can be changed only per class, to whole numbers from 1 to 100, affecting that class’s future redemptions without changing other classes, the personal initial template or already-owned backgrounds. Redeem for a student in the shop’s **Backgrounds** tab to unlock only; it does not automatically equip the background. Open **Dress up** from the student card or shop to filter, preview and apply owned backgrounds, or restore the always-free default. Holiday themes do not switch automatically. During the matching festival, its background can be applied temporarily for free in the school time zone, without badge spending, redemption records or permanent ownership. The previous permanent background (or default) returns when access expires; redeemed backgrounds remain usable year-round. The four everyday scenes do not participate. Backgrounds belong to the student and survive companion changes and graduation. Owned backgrounds cannot be charged for again and remain usable after removal from sale. A refund revokes ownership and restores the default if that background was in use.

Festival dates are evaluated offline on the server in the class’s school time zone (default `Asia/Shanghai`), not from browser dates or client-supplied free flags. Little New Year covers lunar December 23 and 24, without repeating festivals in leap months or extending them to substitute holidays. Mother’s Day is the second Sunday in May, Father’s Day the third Sunday in June, Thanksgiving the fourth Thursday in November, and Easter follows the Western calendar. Hanukkah covers eight local civil days. Diwali uses the New Delhi Lakshmi Puja main day, individually verified for 2026–2030 against [Drik Panchang](https://www.drikpanchang.com/festivals/lakshmipuja/festivals-lakshmipuja-timings.html?geoname-id=1261481) and [timeanddate India](https://www.timeanddate.com/holidays/india/diwali); unverified years explicitly show that free access is unsupported rather than guessing a date. Independent expiry timers remove temporary access even while offline or saving. Zero badges or removal from sale do not block a valid free offer; permanent redemptions keep their regular price.

Any class teacher may generate or disable an invitation code. Codes have six groups of four hexadecimal characters, last seven days, allow multiple teachers to join, and are shown in plaintext only when generated. A new code invalidates the old one. Joining requires signing in, completing a profile, previewing the class and confirming; teachers who already have classes can join more. Co-admins may manage the class name, students, evaluations, redemptions, rules, growth settings, rewards and invitations. Only the owner may delete the class, remove members, transfer ownership or export that class’s backup. Co-admins may leave; owners must transfer ownership to an existing member first. The former owner remains a co-admin. Removal and transfer invalidate the current invitation code without deleting history. Teaching roles are descriptive, not permission grants.

Evaluation and redemption history preserve the teacher’s name and subject at the time, with attribution for undo/refunds. Renaming or leaving never rewrites historical names; older records with no known actor are labeled historical records. Owners can undo any class record; co-admins can undo only their own evaluation batches and redemptions, subject to the existing pet-cycle and badge-balance restrictions.

Passwords are hashed with scrypt. Sessions use HttpOnly, SameSite=Lax cookies. Every business request checks the authenticated teacher’s class membership or owner permission on the server. The current class’s latest 200 evaluation records are shown in the interface; all records remain in SQLite and backups. Import up to 500 students at a time; backup restores are limited to 50 MB. Class teachers can configure seven growth thresholds and badge amounts (including zero) under Rules, independently for the current class. Changes preserve level and within-level progress immediately; existing rewards retain their original amounts, even after undo and re-earning. Defaults remain 700 experience to graduate, one badge per level, and zero-clamped growth. Optional sick and egg states enable signed experience for subsequent evaluations. At Lv.1, a pet appears sick immediately when the total points on its card are negative, regardless of whether cycle experience is negative; it recovers at zero points. The egg state takes priority when both conditions apply. An egg is a recoverable appearance, not a data reset: it triggers immediately when the total points shown on the student card reach or fall below the configured threshold (default -10), independently of cycle experience, and recovers above it. Hunger reminders use the last active positive evaluation or adoption, the school time zone, and optional weekend/school-holiday exclusions. They never deduct points. Old adoption timestamps fall back to student creation time. Badge spending never removes collection honors. Upload PNG/JPEG/WebP images up to 2 MB; the server re-encodes them to WebP at up to 512px and 256 KB each. Processed images have a separate 10 MB total limit per class or personal initial template, not per account.

Version 7 JSON backups contain only classes currently owned by the exporter, their class-specific resources, images, settings versions, growth events, reward locks and historical teacher names, plus the personal initial template. They include background shop items, background snapshots in redemption records and each student’s permanent equipped background. Temporary festival selections and expiry timestamps are excluded; restored classes start with no temporary selection and festival eligibility is recalculated on the server. Ownership is derived from valid, non-refunded redemptions and is not exported as a separate list. Backups exclude co-admin-only classes, account credentials, membership permissions and invitation codes.

Versions 1–6 can also be imported after validation against their original formats. The version 5 schema and background-ID allowlist remain frozen to the original four scenes, and version 6 remains frozen to the original 32; version 7 accepts all 41. Any teacher with a complete profile may import a backup. Import atomically creates new class copies owned by the importing teacher; it never replaces existing classes, co-managed data or the personal initial template, and never restores other teachers’ access or binds historical actor IDs to accounts. Copies imported from versions 1–4 initialize all 41 background items. Version 5 copies add only the original 28 holiday items and the nine new Chinese holidays, preserving the original four items’ prices, delisted status and missing entries. Version 6 copies add only the new nine items and preserve the original 32 items’ state. Version 7 restores the backed-up items without filling missing entries. A failed import rolls back completely.

The database is at version 8; backups remain at version 7. Version 8 only adds temporary festival-background and expiry columns, leaving permanent ownership, prices and equipment unchanged. Changing a class’s school time zone clears that class’s temporary selections in the same transaction. The version 4 migration preserves legacy growth and redemption history, settings versions and reward locks while copying account configuration into each existing class. Version 5 adds background fields and seeds the original four scenes. Version 6 remains fixed to adding the original 28 holiday items. Version 7 adds only the nine new Chinese holiday items to personal initial templates and existing classes in a one-time migration. It does not recreate missing older items, relist delisted items, or alter existing prices, ownership or equipped backgrounds. Database migration runs transactionally and rolls back on failure.

### Vercel + Turso (Singapore)

The web deployment uses Turso in `aws-ap-southeast-1` and Vercel Functions in `sin1`. Configure server-only `TURSO_DATABASE_URL` and secret `TURSO_AUTH_TOKEN` for Production. Configure a separate test database for previews. Missing Turso configuration fails closed on Vercel. Desktop builds continue using local SQLite.

Install dependencies with `pnpm install --frozen-lockfile`, then authenticate with `pnpm dlx vercel@65.9.0 login` and `turso auth login`. Use `pnpm deploy:vercel --dry-run` for a local plan, `pnpm deploy:check` for configuration/database checks plus typechecking/tests without publishing, and `pnpm deploy:vercel` for the full release. Node.js ≥22.13, pnpm, curl and authenticated Turso CLI are required (tested with Turso CLI 1.0.34; override its path with `TURSO_CLI`). CI can supply `VERCEL_TOKEN` through its secret environment.

The script targets the existing project/team and Singapore services. It builds a staged production deployment with `--skip-domain`, runs database migrations, then promotes and verifies **https://pet.pageon.cc**. Failed builds or migrations prevent promotion. Tests run without inherited database/Vercel environment variables. Verification checks the exact deployment behind the custom domain and the live Turso health endpoint, retrying up to six times. A failed verification exits nonzero; compatible committed migrations are retained and old backups are never automatically restored over live data. Standard proxy variables such as `HTTPS_PROXY` can be used; TLS verification stays enabled.

Run `pnpm db:check` to inspect the database independently, or `pnpm db:migrate` for backup, rehearsal and migration. The Turso CLI mints a one-day database-scoped token in memory (read-only for checks); app secrets are not retrieved or saved. Pending migrations require a full SQLite snapshot, integrity/foreign-key checks and a rehearsal that verifies all existing table data. Backups are saved under `data/backups/turso/`, excluded from Git and Vercel. Cloud changes, row-count checks, migration history and the schema marker commit in one atomic batch. The initial v8 baseline is adopted without recreating business tables. Only additive DDL is accepted; destructive operations are rejected. See [migration authoring and recovery](migrations/turso/README.md). Direct CLI/Git deployments bypass this workflow and must not be used to release database upgrades.

Cloud backup import/export is limited to 4 MB to fit the Vercel payload limit; desktop and self-hosted builds retain 50 MB. Larger cloud transfers require an object-storage upload flow.

The cloud database must already have the v8 baseline and `_pet_bloom_schema(id=1, version=8)` before first adoption. Local data and sessions are not uploaded automatically, and local `PRAGMA user_version` migrations are not run remotely. Batch scoring, undo, redemption and restore remain transactional. Set `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` only for a dedicated test database to run the optional cloud integration test.

### Persistence and deployment

SQLite defaults to `data/pet-garden.db`. Set `DATABASE_PATH` to a persistent server-side path. Use `pnpm build` followed by `pnpm start`, or `docker compose up --build -d`. The Docker named volume preserves the database between container replacements. For HTTPS, set `COOKIE_SECURE=true` and `APP_ORIGIN` to your public origin.

The local SQLite configuration requires a persistent disk and a single server; it is not suitable for ephemeral Serverless storage or independent databases on multiple replicas. Back up through the app or SQLite’s backup API. Do not copy only the main database file while WAL writes are active. Backups contain student information and must be protected.

### Validation and asset licensing

Run `pnpm typecheck`, `pnpm test` and `pnpm build`. Tests use in-memory databases. Base pet artwork and original rule definitions are imported third-party resources, with asset notes and checksums recorded in `public/pets/`. Confirm the imported artwork’s license before public deployment or redistribution, or replace it with licensed assets. No third-party application scripts are shipped.

The 41 SVG scenes in `public/pet-backgrounds/` (four everyday, 22 Chinese holiday and 15 international or overseas holiday backgrounds) are original vector backgrounds created for this project, not sourced from third-party sites. They do not replace the original pet images. The full catalog and its provenance are recorded in the existing `public/pets/SOURCES.md`.
