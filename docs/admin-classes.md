# 全局班级管理 / Global class administration

`/zh/admin`、`/en/admin` 展示当前应用数据库中的全部班级，支持分页、名称搜索、概要详情及进入班级。每个班级 ID 只展示一条，关联教师集中显示在同一条记录中；同名但 ID 不同的班级仍是独立班级。概要不包含学生档案或账号凭据。

The overview covers the current application database. Each class ID appears once with all associated teachers, regardless of the number of memberships. Distinct classes with identical names remain separate. The entry link opens that class in the ordinary workspace and survives a page reload.

## 管理员配置 / Admin configuration

服务端环境变量 `PET_GARDEN_ADMIN_USER_IDS` 接受已批准用户的完整 UUID，以逗号分隔。空配置或任意无效条目均拒绝全局访问。每次请求重新验证会话、用户和白名单。用户名为 `admin`、教学身份、班级共同管理员及客户端传入的 role / userId 均不授予全局权限。工作台的“全部班级”入口仅对白名单管理员显示，服务端独立校验权限。

Set `PET_GARDEN_ADMIN_USER_IDS` to explicitly approved existing user UUIDs. Never use a `NEXT_PUBLIC_` prefix or infer authorization from display names. Restart/redeploy after changing the environment. Removing an ID removes global access on subsequent requests; any existing class membership still grants its normal permissions.

## 班级权限 / Class permissions

全局管理员可进入任意班级，管理学生、宠物、评分及撤回、兑换及撤回、规则、成长设置、商店、教师邀请、成员移除、负责人转让、班级删除和备份。原有事务、归档、宠物周期及余额校验继续生效。操作使用管理员自己的身份记录历史署名；进入班级不会自动加入成员或改变负责人。

Global admins receive owner-level class capabilities through the `global_admin` role. Existing owners remain owners; co-admins keep their existing restrictions. Global access is checked on the server for every class operation. Export includes all classes and the admin's own initial template, excluding other teachers' personal templates, credentials, memberships and invitation codes. Import still creates new class copies.

## API 与列表 / API and listing

- `GET /api/admin/access`：当前登录用户是否拥有全局权限，不返回白名单。
- `GET /api/admin/classes?page=1&pageSize=20&search=…`：总数及当前页；每页默认 20、最大 100，page 范围 1–1,000,000，search 最多 80 字符；按创建时间降序、ID 升序排列，搜索为字面包含匹配。
- `GET /api/admin/classes/:id`：班级概要、关联教师及聚合人数，缺失班级返回 404。
- `/api/admin/*` 仅提供读取；实际管理沿用现有业务接口。未登录／过期会话返回 401，无全局权限访问总览返回 403；响应禁用缓存。

Class summaries count active and archived students separately when `students.archived_at` exists, and retain compatibility with older schemas. Teachers are attached after class pagination, so shared memberships cannot duplicate rows or inflate totals. This change requires no database migration.

## 验收 / Verification

1. `pnpm typecheck`、`pnpm test`、`BUILD_DIR=.next-build pnpm build`。
2. `pnpm test:admin` 使用隔离 SQLite、生产服务和 Chrome；截图与结果写入忽略的 `data/admin-evidence-*`。默认 macOS Chrome，其他环境可设置 `CHROME_PATH`。
3. 核对中英文、390px 手机布局、23 班分页、搜索、同班多教师、进入及刷新班级、管理控件、错误重试、失效会话和普通教师隐藏入口。
4. 单元及真实 Route Handler 测试覆盖管理员操作、历史署名、撤销授权、成员权限降级、普通教师越权、同名独立班级及本地 libSQL。

Browser tests use synthetic users and data. Production release follows `pnpm deploy:vercel`; these isolated tests do not mutate production classes.
