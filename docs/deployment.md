# 部署与数据维护 / Deployment and data maintenance

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

云迁移从现有 schema v8 接管，登记基线后执行 v9 归档增量，不重建业务表、不覆盖数据。迁移文件位于 `migrations/turso`，校验和、已执行版本记录在 `_pet_bloom_migrations`。有待执行迁移时，先导出包含账号、会话和全部业务表的完整快照到 `data/backups/turso/`，验证完整性和外键，并在快照上演练、逐表核对原有字段和记录；演练回滚后保留迁移前的 `snapshot.db`。云端使用单个写事务批次执行变更、核对行数并更新版本，任一步失败则整批回滚。备份目录已排除 Git 和 Vercel 上传。

自动迁移仅支持新增表、索引和兼容旧版写入的可空字段；删表、删字段、重命名、覆盖数据被拒绝。新增迁移、版本更新与恢复步骤见 [迁移说明](../migrations/turso/README.md)。本地数据不会自动上传；本地 `PRAGMA user_version` 迁移不在云端运行。生产应通过此脚本发布；直接运行 `vercel deploy` 或 Vercel Git 自动部署会绕过迁移流程，不应作为数据库升级的发布入口。

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


---

### Vercel + Turso (Singapore)

The web deployment uses Turso in `aws-ap-southeast-1` and Vercel Functions in `sin1`. Configure server-only `TURSO_DATABASE_URL` and secret `TURSO_AUTH_TOKEN` for Production. Configure a separate test database for previews. Missing Turso configuration fails closed on Vercel. Desktop builds continue using local SQLite.

Install dependencies with `pnpm install --frozen-lockfile`, then authenticate with `pnpm dlx vercel@65.9.0 login` and `turso auth login`. Use `pnpm deploy:vercel --dry-run` for a local plan, `pnpm deploy:check` for configuration/database checks plus typechecking/tests without publishing, and `pnpm deploy:vercel` for the full release. Node.js ≥22.13, pnpm, curl and authenticated Turso CLI are required (tested with Turso CLI 1.0.34; override its path with `TURSO_CLI`). CI can supply `VERCEL_TOKEN` through its secret environment.

The script targets the existing project/team and Singapore services. It builds a staged production deployment with `--skip-domain`, runs database migrations, then promotes and verifies **https://pet.pageon.cc**. Failed builds or migrations prevent promotion. Tests run without inherited database/Vercel environment variables. Verification checks the exact deployment behind the custom domain and the live Turso health endpoint, retrying up to six times. A failed verification exits nonzero; compatible committed migrations are retained and old backups are never automatically restored over live data. Standard proxy variables such as `HTTPS_PROXY` can be used; TLS verification stays enabled.

Run `pnpm db:check` to inspect the database independently, or `pnpm db:migrate` for backup, rehearsal and migration. The Turso CLI mints a one-day database-scoped token in memory (read-only for checks); app secrets are not retrieved or saved. Pending migrations require a full SQLite snapshot, integrity/foreign-key checks and a rehearsal that verifies all existing table data. Backups are saved under `data/backups/turso/`, excluded from Git and Vercel. Cloud changes, row-count checks, migration history and the schema marker commit in one atomic batch. The initial v8 baseline is adopted without recreating business tables. Only additive DDL is accepted; destructive operations are rejected. See [migration authoring and recovery](../migrations/turso/README.md). Direct CLI/Git deployments bypass this workflow and must not be used to release database upgrades.

Cloud backup import/export is limited to 4 MB to fit the Vercel payload limit; desktop and self-hosted builds retain 50 MB. Larger cloud transfers require an object-storage upload flow.

The cloud database must already have the v8 baseline and `_pet_bloom_schema(id=1, version=8)` before first adoption. Local data and sessions are not uploaded automatically, and local `PRAGMA user_version` migrations are not run remotely. Batch scoring, undo, redemption and restore remain transactional. Set `TURSO_TEST_DATABASE_URL` and `TURSO_TEST_AUTH_TOKEN` only for a dedicated test database to run the optional cloud integration test.

### Persistence and deployment

SQLite defaults to `data/pet-garden.db`. Set `DATABASE_PATH` to a persistent server-side path. Use `pnpm build` followed by `pnpm start`, or `docker compose up --build -d`. The Docker named volume preserves the database between container replacements. For HTTPS, set `COOKIE_SECURE=true` and `APP_ORIGIN` to your public origin.

The local SQLite configuration requires a persistent disk and a single server; it is not suitable for ephemeral Serverless storage or independent databases on multiple replicas. Back up through the app or SQLite’s backup API. Do not copy only the main database file while WAL writes are active. Backups contain student information and must be protected.

