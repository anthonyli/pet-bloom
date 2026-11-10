# ABCD-12 备份导入恢复验证

修复区分导入已成功、结果未知和明确拒绝。成功响应中的 `classIds` 在刷新之前保存；刷新失败后只提供 GET 重载，原 POST 确认入口被移除。网络中断、5xx 或无效成功响应进入未知状态，要求加载并核对班级；4xx 保留纠正文件后重试的入口。

设置属于当前账号，不再因首次加载班级而销毁导入结果。进入副本使用 GET，加载失败时保留选择和结果。

## 自动验收

需要 Node.js 22.13+、仓库锁定的 pnpm，以及 Chrome。也可用 `PLAYWRIGHT_EXECUTABLE_PATH` 指定已安装的兼容 Chromium。

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm typecheck
pnpm test
BUILD_DIR=.next-build pnpm build
pnpm test:restore
```

`scripts/test-restore.mjs` 启动隔离的生产构建服务，动态生成测试账号和临时 SQLite 数据库，不继承云数据库凭据。测试结束关闭浏览器、服务并删除数据库。默认将截图和不含 Cookie、密码或备份内容的 `network-evidence.json` 写入被 Git 忽略的 `data/restore-regression/`；可通过 `RESTORE_EVIDENCE_DIR` 改变证据目录。

中英文分别执行以下 8 个场景，共 16 个：

| 场景 | 故障注入与断言 |
| --- | --- |
| saved-500 | 真实 restore POST 成功后 state GET 返回 500；原确认按钮消失，文件入口停用，失败重载与恢复重载均不再 POST，保留结果后可选择第二个副本 |
| saved-network | 同上，state GET 改为网络中断 |
| lost-response | 真实 POST 已提交后丢弃响应；显示未知提示，GET 重载后核对列表，重新打开设置没有旧确认按钮 |
| server-500 | 真实 POST 已提交后替换为 500，防守处理结果未知，重载不增加副本 |
| malformed-success | 真实 POST 已提交后替换为无效的 200 JSON，仍按未知处理 |
| rejected-400 | 真实服务拒绝无效备份且班级数不变；改选合法文件后成功，两个 POST 中只有一次导入 |
| success | 常规导入后选择第二个副本；进入班级的 GET 失败时保留窗口，再次 GET 成功后进入 |
| first-classes | 从零班级开始导入，刷新失败后重载，首次自动选中班级仍保留结果及副本选择 |

除明确拒绝后修正重试为两个 POST 外，每个场景均断言 POST 为一次，真实数据库班级数只增加两个。脚本记录所有浏览器 restore/state 请求；从真实 state API 验证班级数，未模拟数据库。saved-500 另保存 390×844 手机视口截图并检查窗口无横向溢出。

## 手动复核

1. 使用测试教师导出的合法备份，打开“设置与数据”，选择文件并确认。
2. 只让随后 `/api/state` 失败，保留 `/api/restore` 的成功响应。应显示已导入和已创建数量，不能再次确认导入；点击“重新加载班级”应只有 GET。
3. 恢复网络并重载，选择另一个导入班级，点击“进入新班级”；确认进入所选副本。
4. 将 restore 响应丢弃，确认显示未知结果，重新加载后提示核对班级列表；无旧文件的直接重发入口。
5. 换成无效备份，确认校验错误后仍能改选合法文件；切换英文重复检查。

验证范围为本机 Chrome、真实 Next.js Route Handler 和本地 SQLite。没有执行生产部署、云迁移或远端 Turso 联调；此修复不增加服务端幂等机制，也不承诺跨窗口或整页重载的导入去重。
