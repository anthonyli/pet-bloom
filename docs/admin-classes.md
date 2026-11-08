# 全局班级只读总览 / Global class overview

`/zh/admin`、`/en/admin` 展示当前应用数据库中的全部班级，支持服务端分页、班级名称搜索和概要详情。字段来自现有模型：名称、负责人称呼和学科、创建时间、在班人数、归档人数及班级教师数。没有班级归档状态，界面不虚构状态。详情不返回学生姓名、评价、宠物档案、账号登录名、口令或会话。

The overview covers only the database selected by this application, using the existing SQLite or Turso connection. It does not discover other databases or installations. Summaries contain class and owner information and aggregate counts; they do not expose student records or credentials.

## 管理员配置 / Admin configuration

仅服务端环境变量 `PET_GARDEN_ADMIN_USER_IDS` 接受现有用户的完整 UUID，以逗号分隔。默认空集合；任一非空条目不是有效 UUID 时整体拒绝。逐次请求先验证未过期的 session，再验证用户存在及其 UUID 属于白名单。显示名或用户名为 `admin`、教学身份、班级共同管理员、客户端 role / userId 参数均不能获得全局权限。

Set `PET_GARDEN_ADMIN_USER_IDS` in the server environment to a comma-separated list of explicitly approved existing user UUIDs. Empty or malformed configuration denies access. The list must never use a `NEXT_PUBLIC_` prefix. Restart/redeploy the service after changing its environment. Removing an ID denies subsequent requests; already displayed data is cleared on an authorization failure. Global access grants no additional ordinary class read/write permissions.

**生产管理员 UUID 尚待成员指定。** 本 PR 不指定真实账号、不修改生产配置、不执行迁移或部署。配置示例为空。上线时由应用负责人核实已批准用户的 UUID，并按已有发布流程配置；不要凭显示名猜测身份。

**Production admin identities are still to be designated by the owner.** This change supplies implementation and an empty example only. It grants no real account access and performs no production migration or deployment.

## API 与归档兼容 / API and archive compatibility

- `GET /api/admin/access`：已登录用户自身是否拥有全局只读访问权；不返回配置名单。
- `GET /api/admin/classes?page=1&pageSize=20&search=…`：总数和当前页，默认每页 20，最大 100；page 为 1–1,000,000 整数，search 最多 80 字符。按创建时间降序、ID 升序稳定排序；搜索为字面包含匹配，`%`、`_` 不作为通配符。
- `GET /api/admin/classes/:id`：重新校验权限后返回必要概要，缺失班级返回 404。
- 未登录／过期会话返回 401，无全局权限返回 403。该命名空间仅导出 GET，Next.js 自动处理 HEAD；写方法返回 405。成功与失败响应均 `Cache-Control: no-store`、`Vary: Cookie`。

All admin reads are independently authorized; hiding the workspace link is only a convenience. The existing catch-all authentication and write routes remain unchanged, including the separate ABCD-11 login rate-limit work. There is no student login role in the current model; unauthenticated student-side requests receive 401, and any ordinary account receives 403.

ABCD-14 / PR #3 拥有 schema v9 的 `students.archived_at` 迁移，本 PR 不复制或依赖该迁移。领域查询通过当前连接的表元数据检测字段：字段不存在时全员在班、归档 0，并提示尚未启用归档；存在时按 NULL / 非 NULL 分别统计。使用受限概要投影，不复用包含学生档案及可写资源的 snapshot。不提供历史学生档案入口；历史仍在原有班级权限下由归档功能查看。

Before ABCD-14 lands, all students count as active. Once its additive field exists, counts distinguish active and archived students automatically. Tests cover both schema shapes and local SQLite/libSQL. No migration is added here.

## 验收 / Verification

1. `pnpm typecheck`、`pnpm test`、`BUILD_DIR=.next-build pnpm build`。
2. `pnpm test:admin`：启动并最终关闭隔离生产服务及 Chrome。默认 Chrome 路径为 macOS Google Chrome；其他环境设 `CHROME_PATH`。测试数据、截图、服务日志和 `results.json` 写入忽略的 `data/admin-evidence-*`，不使用已有数据库或真实账号。
3. 浏览器从工作台“全部班级”进入，核对两位测试教师共 23 班的两页覆盖，搜索班级并查看概要；Escape 关闭后焦点回到原行。核对空结果、加载、列表／详情失败与重试。
4. 中英文及 390px 手机布局检查；未登录、过期 session、普通教师、名为 admin 的共同管理员、伪造权限参数、直接替换 classId 均被拒绝；全局管理员不能改写其他教师班级。

`tests/admin-classes.test.ts` exercises real Route Handlers and database methods, including local libSQL (not cloud Turso). The browser script exercises actual HTTP and Chrome with synthetic users, and injects only explicit network delay/500 responses to verify recovery. Its archive counts use a local fixture matching ABCD-14's column contract; this is not a claim that ABCD-14's archive UI or production Turso was exercised.
