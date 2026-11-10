# Turso 数据迁移 / Turso database migrations

## 执行

```bash
pnpm db:check    # 只检查，不修改数据库
pnpm db:migrate  # 备份 → 迁移演练 → 原子迁移
```

部署命令 `pnpm deploy:vercel` 会在构建成功后、生产域名切换前调用同一个迁移脚本。有待执行迁移时必须有已登录的 Turso CLI 和可写的本地备份目录；备份或演练失败就停止。没有待执行迁移时只核验状态，不生成重复备份。

目标固定为新加坡的 `pet-bloom`。`TURSO_CLI` 可指定 CLI 路径。脚本临时生成有效期 1 天的数据库令牌，仅保存在内存中；不接收命令行密钥，不下载 Vercel 的应用密钥。

## 新增迁移

`008-baseline.json` 是冻结的 v8 结构，不会在现有数据库执行建表；首次接管会检查结构并写入迁移历史。不要编辑已执行的迁移，校验和不一致会阻止发布。

`009-student-archive.json` 为学生归档追加可空时间列，旧数据保持在班。Migration 009 adds a nullable archive timestamp; existing students remain active.

未来新增字段的文件例如 `010-student-note.json`：

```json
{
  "version": 10,
  "name": "student-note",
  "kind": "expand",
  "statements": [
    "ALTER TABLE students ADD COLUMN note TEXT",
    "CREATE INDEX students_note ON students(note)"
  ]
}
```

这是文档示例，仓库当前并未执行 v9。实际新增时：

1. 按连续版本添加 JSON 文件；每个数组元素是一条无注释 SQL。
2. 更新 `lib/server/schema-version.json` 的 `current`，同步实现 `lib/server/db.ts` 中的本地 SQLite 升级，确保桌面与云端结构一致。
3. 新字段须可空，可选字面量默认值；应用应兼容已有行的空值。新表和索引不能破坏旧版业务语义，尤其注意唯一索引对旧版写入的影响。
4. 运行 `pnpm typecheck`、`pnpm test`、`pnpm deploy:check`，然后用部署命令发布。

自动流程不接受 `UPDATE`、`DELETE`、重命名、删表/字段、触发器或手动事务语句。更复杂的数据转换应设计为分阶段的兼容升级，单独实现并测试迁移逻辑，不要绕过校验直接改生产表。云端旧版本允许读取更高版本的兼容结构；发布脚本拒绝用旧迁移目录覆盖更高版本数据库。

## 数据保护与恢复

- 快照位于 `data/backups/turso/<时间-随机标识>/snapshot.db`，`manifest.json` 记录 SHA-256、版本和各表摘要。它包含所有教师账号、密码哈希、会话、班级、学生、评分、兑换和迁移元数据，不是网页中仅针对某位教师的 JSON 备份。目录权限为 `0700`，快照为 `0600`，并排除 Git/Vercel 上传。请将所需快照额外保存到受控备份存储；脚本不自动上传或清理备份。
- Turso 导出可能带 WAL；脚本通过 SQLite backup API 合并为可独立打开的 `snapshot.db`，校验完整性和外键。演练核对原有字段、行数、rowid 和完整值摘要，随后回滚演练，保留迁移前快照。
- 生产迁移在单个服务器端写事务批次中完成，使用结构/版本/历史断言阻止并发迁移，核对业务表行数和外键，最后才提交版本标记。迁移期间写入可能短暂等待。超限、约束错误或并发冲突会中止整批操作。
- 数据库提交和 Vercel 域名切换不是同一个事务。切换失败时兼容迁移保留，旧版继续使用原有数据；修复构建或网络后重新部署即可，已执行迁移不会重复执行。网络中断时先 `pnpm db:check` 确认提交结果，不自动重放或恢复旧库。
- 需要灾难恢复时，先保留当前数据库及新增数据，再校验快照 SHA-256 和 `PRAGMA integrity_check`，把快照导入**新的新加坡数据库**，验证账号和业务记录后再切换应用连接。不要直接覆盖活跃生产库，否则会丢掉快照之后产生的数据。恢复数据库名称变化时须同步更新部署目标配置和 Vercel 环境变量。

## English

`pnpm db:check` inspects schema, migration history and pending files without database writes. `pnpm db:migrate` creates a verified full backup, rehearses the migration, then commits it atomically. The deployment script calls the same command after a successful staged build and before promotion. An authenticated Turso CLI and writable backup storage are required. Tokens expire after one day and remain in memory; application secrets are not retrieved.

The v8 baseline is adopted without recreating existing tables. Never edit applied migration files. Add contiguous `expand` JSON files, update `lib/server/schema-version.json`, and implement matching desktop SQLite migrations. Each statement must add a table, index or nullable column (with an optional literal default). Application code must handle existing null values, and indexes must remain compatible with old writes. Destructive changes and data updates are rejected; more complex transformations require a separately implemented and tested compatibility plan. The v9 example above is documentation only.

Backups live in `data/backups/turso/` and include accounts, password hashes, sessions and all business data. They are excluded from Git/Vercel, use private permissions, and should be copied to controlled backup storage when retention is required. The SQLite backup API consolidates exported WAL frames into `snapshot.db`; integrity checks and a rolled-back rehearsal verify existing values, rowids and counts. `manifest.json` records checksums and table summaries.

Cloud DDL, history, count/foreign-key checks and the version marker commit in a single server-side transaction. Schema/history assertions prevent stale concurrent runners; failures abort the batch. Promotion is a separate operation: compatible committed migrations remain if promotion fails, and retrying skips applied files. Inspect status after an uncertain network response. Never automatically restore an old snapshot over a live database. For recovery, preserve current data, verify the snapshot, import it into a new Singapore database, validate application behavior, then update the deployment target and environment. Snapshot restoration alone would omit writes made after the snapshot.
