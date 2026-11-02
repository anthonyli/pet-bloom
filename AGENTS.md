# 开发指南

## 架构
- Next.js App Router + React 19 + TypeScript + Tailwind；页面和 API 在单 Node.js 服务运行。
- SQLite 唯一入口为 lib/server/db.ts；领域操作由 lib/server/garden.ts 执行，备份由 lib/server/backup.ts 处理。
- 不依赖同级 pageon 或旧 Vue 项目的运行环境。

## 约定
- 面向用户的文本提供完整中文与英文，默认宠物及规则文案在 lib/data/。
- 表单复用 components/ui；Dialog 使用 Radix，保留标签、键盘、焦点和错误状态。
- 每个业务接口必须验证当前教师归属，不能只信任客户端传入的班级或学生编号。
- 批量评分、撤回、徽章兑换、备份恢复必须在数据库事务中执行。
- 默认规则每位教师注册时初始化，不使用全局共享可变规则。
- 不提交数据库、会话、测试账号密码或环境密钥。
- 云端表结构变更追加到 migrations/turso，已执行的文件不可修改；同步 schema-version.json 与本地 SQLite 迁移。生产通过 pnpm deploy:vercel 先构建、备份及迁移，再切换域名，不得跳过备份或用旧快照自动覆盖生产数据。
- 宠物图片来源记录见 public/pets/SOURCES.md，新增图片必须保留来源。

## 命令
- pnpm dev：3100 端口。
- pnpm typecheck、pnpm test、pnpm build。
- pnpm db:check：只读迁移检查；pnpm db:migrate：独立云迁移；pnpm deploy:vercel：包含迁移的生产发布。
- 开发中另做生产构建：BUILD_DIR=.next-build pnpm build，避免覆盖 .next。
- 本地 SQLite 默认 data/pet-garden.db，自托管部署必须挂载持久化磁盘；Vercel 使用新加坡 Turso，迁移备份保存在发布机器 data/backups/turso。
