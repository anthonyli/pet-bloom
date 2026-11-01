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

**SQLite 需要持久化磁盘。** 不应把此配置原样部署到无持久卷的 Serverless/临时文件系统，也不支持多台服务器各自写一个独立数据库。多教师访问由服务端的班级成员与负责人权限校验控制，而不是每位教师创建一个 `.db` 文件。

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

### Persistence and deployment

SQLite defaults to `data/pet-garden.db`. Set `DATABASE_PATH` to a persistent server-side path. Use `pnpm build` followed by `pnpm start`, or `docker compose up --build -d`. The Docker named volume preserves the database between container replacements. For HTTPS, set `COOKIE_SECURE=true` and `APP_ORIGIN` to your public origin.

This configuration requires a persistent disk and a single server; it is not suitable for ephemeral Serverless storage or independent databases on multiple replicas. Back up through the app or SQLite’s backup API. Do not copy only the main database file while WAL writes are active. Backups contain student information and must be protected.

### Validation and asset licensing

Run `pnpm typecheck`, `pnpm test` and `pnpm build`. Tests use in-memory databases. Base pet artwork and original rule definitions are imported third-party resources, with asset notes and checksums recorded in `public/pets/`. Confirm the imported artwork’s license before public deployment or redistribution, or replace it with licensed assets. No third-party application scripts are shipped.

The 41 SVG scenes in `public/pet-backgrounds/` (four everyday, 22 Chinese holiday and 15 international or overseas holiday backgrounds) are original vector backgrounds created for this project, not sourced from third-party sites. They do not replace the original pet images. The full catalog and its provenance are recorded in the existing `public/pets/SOURCES.md`.
