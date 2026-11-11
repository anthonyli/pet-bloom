# ABCD-14 学生离班归档验收 / Student archive verification

当前学生直接关联一个班级，没有多班学籍关系。归档更新原学生的 `archived_at`、`archive_reason` 和 `archive_note`，恢复将这三个字段设回 null，不创建班级或学生、不调用删除、不清理历史。负责人和共同管理员均按当前班级成员关系授权；已删除班级或失去权限返回 404。归档学生不能新增评分、兑换、编辑或宠物操作。原有历史撤回权限保持不变。

Each student belongs to one class. Archive updates `archived_at`, `archive_reason` and `archive_note`; restore clears them without creating records. Owners and co-admins require current membership. Deleted classes or revoked access return 404. Archived students cannot receive new scores, redemptions, edits or pet operations. Historical undo retains existing permissions.

## 手动验收 / Manual verification

1. 在测试班创建学生、领养宠物、评分并兑换一次背景，记录学生 ID、积分、徽章、成长和历史。Create a test student, adopt a pet, score and redeem a background; record their ID and balances.
2. “更多操作 → 编辑学生 → 归档学生”，选择归档原因（转学、毕业、休学、其他，可不填），填写最多 500 字的选填说明，检查取消及确认；刷新后默认名单、人数、排行榜、商店选项和批量选择排除该生。Select an optional reason and enter an optional note (up to 500 characters), confirm or cancel from the edit dialog, and reload and check active rosters, counts, ranking and daily selectors.
3. 从桌面工具栏或手机“班级工具 → 归档”查看档案、归档时间、原因、说明、评价和兑换历史（旧档案显示“未填写”）。历史每页 50 条，可加载早期记录，不受班级最近 200 条窗口限制。Open Archive on desktop or mobile, view the archive time, reason, note and profile, and load earlier history in pages of 50.
4. 确认恢复，刷新后同一 ID 回到原班，原有数据保持；可以继续评分。重发归档或恢复不会复制数据，也不改首次归档时间、原因和说明。Restore and reload; identity and balances remain, scoring resumes, and retries do not duplicate records.
5. 使用非成员账号请求 `POST /api/students/:id/archive`、`POST /api/students/:id/restore`、`GET /api/students/:id/history` 和 `GET /api/state?classId=...`，应拒绝。归档后直接评分应返回 409 `studentArchived`，混合批量评分全部回滚。Verify unauthorized requests fail and archived/mixed scoring is rejected atomically.
6. 导出 v9 备份，再导入新副本；归档状态、原因、说明和历史保持。v8 保留归档状态并补空原因、说明；v1–v7 导入学生保持在班。Export/import v9 and verify archive details persist. v8 retains archive status with empty details; v1–v7 remain active.

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
- 云端新增 `migrations/turso/009-student-archive.json`；未修改已执行的 008 基线。追加 `010-student-archive-details.json` 添加可空 `archive_reason TEXT` 与 `archive_note TEXT`；本地迁移与 `schema-version.json` 同步到 10。`tests/turso-migrations.test.ts` 在本地 libSQL 验证真实增量、迁移前备份、历史保留及本地／云结构一致。
- 2026-11-11 已按用户授权执行生产 `pnpm db:migrate`：完整快照备份及迁移演练通过，010 迁移完成，随后 `pnpm db:check` 确认 schema v10、无待执行迁移。本次仅同步数据库，未执行应用部署。正式发布仍使用 `pnpm deploy:vercel` 的构建、备份、迁移和域名切换流程。不要跳过备份，也不要用旧快照自动覆盖生产数据。

Local v10 and cloud migration 010 add nullable reason and note columns after archive migration 009. Production migration 010 completed on 2026-11-11 after verified backup and rehearsal; the follow-up check confirmed v10 with no pending migrations. Application deployment was not performed. Backup format v9 is separate from database schema v10; older apps cannot import v9 archives and should be upgraded first.
