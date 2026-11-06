# ABCD-14 学生离班归档验收 / Student archive verification

当前学生直接关联一个班级，没有多班学籍关系。归档只更新原学生的 `archived_at`，恢复将它设回 null，不创建班级或学生、不调用删除、不清理历史。负责人和共同管理员均按当前班级成员关系授权；已删除班级或失去权限返回 404。归档学生不能新增评分、兑换、编辑或宠物操作。原有历史撤回权限保持不变。

Each student belongs to one class. Archive updates only `archived_at`; restore clears it without creating records. Owners and co-admins require current membership. Deleted classes or revoked access return 404. Archived students cannot receive new scores, redemptions, edits or pet operations. Historical undo retains existing permissions.

## 手动验收 / Manual verification

1. 在测试班创建学生、领养宠物、评分并兑换一次背景，记录学生 ID、积分、徽章、成长和历史。Create a test student, adopt a pet, score and redeem a background; record their ID and balances.
2. “更多操作 → 编辑学生 → 归档学生”，检查影响说明、取消及确认；刷新后默认名单、人数、排行榜、商店选项和批量选择排除该生。Confirm or cancel the archive from the edit dialog, then reload and check active rosters, counts, ranking and daily selectors.
3. 从桌面工具栏或手机“班级工具 → 已归档学生”查看档案、归档时间、评价和兑换历史。历史每页 50 条，可加载早期记录，不受班级最近 200 条窗口限制。Open Archived students on desktop or mobile, view the archive time and profile, and load earlier history in pages of 50.
4. 确认恢复，刷新后同一 ID 回到原班，原有数据保持；可以继续评分。重发归档或恢复不会复制数据，也不改首次归档时间。Restore and reload; identity and balances remain, scoring resumes, and retries do not duplicate records.
5. 使用非成员账号请求 `POST /api/students/:id/archive`、`POST /api/students/:id/restore`、`GET /api/students/:id/history` 和 `GET /api/state?classId=...`，应拒绝。归档后直接评分应返回 409 `studentArchived`，混合批量评分全部回滚。Verify unauthorized requests fail and archived/mixed scoring is rejected atomically.
6. 导出 v8 备份，再导入新副本；归档状态和历史保持。v1–v7 旧备份导入学生保持在班。Export/import a v8 copy and verify archives persist; legacy backups remain active.

## 自动化 / Automated checks

```sh
pnpm typecheck
pnpm test
BUILD_DIR=.next-build pnpm build
pnpm test:archive
```

`tests/student-archive.test.ts` runs with SQLite and local libSQL, including membership revocation, deleted classes, mixed-batch rollback, 205-entry pagination, backup round-trips, corrupt timestamp rejection, concurrent archive retries and database reopen persistence. `tests/api.test.ts` exercises real route handlers, sessions, CSRF and error codes. Local libSQL may reject overlapping transactions with SQLITE_BUSY; retry is tested without data loss. This is not remote Turso integration.

浏览器脚本需要本机 Google Chrome。它启动独立生产构建服务、使用随机测试账号及隔离 SQLite，结束时关闭浏览器和服务。覆盖中英文 1440px／390px，已提交归档的响应丢失后重试、历史加载失败重试、恢复失败重试、刷新持久化和原数据对比。证据默认输出到被忽略的 `data/archive-evidence/`（PNG、results.json；run 子目录仅含测试数据库和服务日志），可用 `ARCHIVE_EVIDENCE_DIR` 指定目录，不提交数据库或凭据。

The browser script requires Google Chrome and starts/stops its own isolated production server. It verifies both locales at desktop/mobile sizes, lost archive responses, failed history/restore requests, retries, reloads and unchanged records. Screenshots and results are written to the ignored evidence directory; no credentials or databases are committed.

## 迁移 / Migration

- 本地 SQLite v8 → v9 在事务中只追加可空 `archived_at INTEGER`，旧记录默认 null。已有 v1–v7 按原顺序迁移后追加此列。
- 云端新增 `migrations/turso/009-student-archive.json`；未修改已执行的 008 基线。`schema-version.json` 同步到 9。`tests/turso-migrations.test.ts` 在本地 libSQL 验证真实增量、迁移前备份、历史保留及本地／云结构一致。
- 本任务不执行生产迁移或部署。获批准后在发布环境先 `pnpm db:check`；正式发布使用 `pnpm deploy:vercel` 的构建、备份、迁移和域名切换流程。不要跳过备份，也不要用旧快照自动覆盖生产数据。

Local v9 and cloud migration 009 add only a nullable column. Production migration/deployment remains a separate approved operation via the existing backup-first deployment flow. Backup format v8 is separate from database schema v9; older apps cannot import v8 archives and should be upgraded first.
