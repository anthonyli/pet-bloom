# 合并后的自动生产发布 / Automatic production releases

合并 PR 到 `main`（或直接更新 `main`）后，`.github/workflows/production.yml` 串行执行生产发布。任务读取最新 `main`；发布前再次核对远端分支，避免旧任务覆盖新版本。也可在 Actions 手动重试，限 `main`。Fork 和 PR 事件不会取得发布权限。

流程：配置与类型检查、测试 → 云库只读预检 → 构建待发布版本（不切域名）→ 完整快照与恢复演练 → 加密上传备份 → 事务迁移 → 切换生产域名 → 核对部署 ID 与数据库健康。

CI 使用 Vercel 项目 API 构建固定 `main` 提交，明确关闭自动域名分配；构建完成后复核提交 SHA、区域和生产域名未变化，迁移完成后才调用提升 API。项目级令牌无需访问个人账户资料。Vercel CLI 仅供本机发布使用。

任何备份、加密、上传或迁移失败都会阻止上线。即使没有新迁移，自动发布也创建备份。已提交的兼容迁移不会因发布失败而回滚；禁止用旧快照自动覆盖生产数据。连续合并不取消正在运行的迁移。

`vercel.json` 禁用 `main` 的 Git 自动部署，保留其他分支的预览，防止自动部署绕过上述流程。手动本地发布仍使用 `pnpm deploy:vercel`。

## 一次性配置

在仓库 `production` Environment 中只允许 `main` 部署，不设置人工 reviewer 才能全自动运行。配置以下 Secrets（也支持同名 Repository Secrets）：

| Secret | 用途 |
| --- | --- |
| `VERCEL_TOKEN` | Vercel 发布令牌，只授权当前 `pet-bloom` 项目。记录到期日并及时轮换。 |
| `TURSO_API_TOKEN` | Turso 平台 API 令牌，用于查询数据库、导出、签发短期数据库令牌。建议限定现有数据库组，权限仅 `read`、`db:mint-token`。它不是应用的 `TURSO_AUTH_TOKEN`。 |
| `BACKUP_ENCRYPTION_KEY` | 32 字节随机密钥的 64 位十六进制文本。可用 `openssl rand -hex 32` 生成，保存到受控密钥存储；不要提交或打印到日志。 |

工作流固定 Turso CLI 版本并验证发行包 SHA-256。运行时签发的数据库令牌只在内存中使用；发布 Secrets 不传给测试子进程。

## 备份留存与恢复

完整快照包含账号、会话及业务记录。只有 AES-256-GCM 加密后的 `snapshot.db.enc` 和 `manifest.json.enc` 会上传为 `turso-backup-<run>-<attempt>` Artifact，保留 90 天。上传确认发生在第一条生产迁移写入之前。不要上传未加密数据库。Runner 上的临时备份在结束时清理；中断后的加密 Artifact 仍可下载。

下载 Artifact 后，在受控机器将对应版本的密钥注入 `BACKUP_ENCRYPTION_KEY` 环境变量：

```sh
node scripts/decrypt-backup.mjs snapshot.db.enc snapshot.db
node scripts/decrypt-backup.mjs manifest.json.enc manifest.json
```

解密会验证认证标签，不覆盖已有文件，验证失败不发布输出。校验 manifest 的 SHA-256、SQLite 完整性和外键后，导入**新的数据库**，验证后再切换连接。保留旧密钥直到对应备份全部过期；如需超过 90 天的留存，提前将加密 Artifact 转存到受控存储。

## English

Changes merged or pushed to `main` trigger a serialized production workflow. It checks out the latest main branch and refuses stale promotion. Tests and a staged build run before a verified full backup is encrypted and durably uploaded, then migrations commit atomically, production is promoted and verified. Every automatic release backs up, even with no pending migrations. Failure stops promotion; committed additive migrations remain compatible with the previous application.

CI uses project APIs with a pinned Git commit and automatic domain assignment disabled. It verifies the built commit and unchanged production alias before migrating, then promotes through the project API. The project token does not need access to a user profile; the CLI remains available for local releases.

Configure the three secrets above, restrict the `production` Environment to `main`, and omit manual reviewers for unattended releases. Only encrypted snapshots and manifests are retained as GitHub Actions artifacts for 90 days. Preserve the matching encryption keys separately. Restoration is a manual operation into a new database, never an automatic overwrite of production. Native Vercel Git deployment is disabled only for main; preview branches continue to build.

References: [Vercel Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration), [GitHub artifact toolkit](https://github.com/actions/toolkit/tree/main/packages/artifact).
