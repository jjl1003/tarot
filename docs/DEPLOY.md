# Vercel + Neon 邀请码体验版部署

推荐用于个人、非商业的小范围邀请体验：Vercel Hobby 托管页面及 Node.js Functions，Neon PostgreSQL 保存额度、限流和生成名额。模型费用由你承担，API Key 只在服务端配置。无需改成 Next.js，也不需要 Redis。浏览器历史和牌灵档案继续保存在各自设备，不做云同步。

原来的本地模式仍可使用；已有 Render 单实例部署说明见 [Render 部署](DEPLOY-RENDER.md)。

## 1. 准备账号和免费方案

1. 将项目推送到自己的 GitHub 仓库。
2. 在 Neon 创建 Free 项目。数据库地区尽量靠近之后选定的 Vercel 函数地区。
3. 在 Vercel 导入仓库，Framework Preset 选择 **Other**，Node.js 选择 **24.x**，启用 Fluid Compute。使用仓库的构建命令 `npm test` 和输出目录 `public`，安装依赖使用默认的 npm 安装流程（包含开发依赖，以运行数据库测试）。
4. 可通过 Vercel Marketplace 连接 Neon，也可以在 Neon 独立创建后手动配置连接串。创建时确认选择的是免费方案，不启用付费升级。

Vercel Hobby 限个人非商业用途，且托管、函数、数据库都有各自的用量限制；免费额度不包含模型 API 消费。实际额度以创建时控制台为准，不能承诺长期零费用。先用少量邀请码试运行。Neon 空闲后恢复连接可能增加首次请求延迟。

参考：[Vercel Hobby](https://vercel.com/docs/plans/hobby)、[Neon 集成](https://vercel.com/marketplace/neon)、[函数运行限制](https://vercel.com/docs/functions/limitations)。

## 2. 初始化数据库

先安装依赖：

```sh
npm ci
```

在 Neon 的 SQL Editor 执行 [数据库迁移](../migrations/001-runtime.sql) 的全部内容。脚本可重复执行，不会清空已有额度。不要把初始化迁移放进每次请求或构建中执行。

也可以在本机受忽略的 `.env` 中设置 `DATABASE_URL`，然后运行：

```sh
npm run db:init
```

连接串从 Neon 的 Connect 页面获取，应用运行建议使用 pooled 连接串（主机名含 `-pooler`），保留 TLS 配置；支持 `sslmode=verify-full`。不要把连接串写入源码或聊天。数据库账号需要读取和更新 `tarot_runtime` 表的权限，初始化时还需要建表权限。

数据库只保存邀请码 SHA-256 标识、日期和次数、登录地址哈希及短期并发租约，不保存明文邀请码、问题、牌面、对话或模型密钥。

## 3. 配置 Vercel 环境变量

先在本机执行：

```sh
npm run create-secrets
```

生成邀请码列表及会话签名密钥，并复制到 Vercel 的 **Production** 环境变量。不要将输出提交到 Git。首次创建项目时可以先分配项目名，得到固定生产地址；配置齐全并初始化数据库后再正式部署。

| 环境变量 | 设置 |
| --- | --- |
| `TAROT_MODE` | `hosted`（Vercel 入口也会强制使用线上模式） |
| `APP_ORIGIN` | 固定生产根地址，例如 `https://你的项目.vercel.app`，不含路径 |
| `DATABASE_URL` | Neon 的 PostgreSQL pooled 连接串 |
| `TAROT_API_BASE_URL` | 可信模型服务的 HTTPS 基础地址 |
| `TAROT_API_KEY` | 你的模型密钥 |
| `TAROT_MODEL` | 服务商支持的准确模型名 |
| `TAROT_INVITE_CODES` | 工具生成的 JSON 字符串数组 |
| `TAROT_SESSION_SECRET` | 工具生成的至少 32 字符密钥 |

Vercel 不使用 `TAROT_USAGE_FILE`。缺少 `DATABASE_URL` 时服务拒绝启动，不会退回临时文件或无限额度。

所有敏感配置只用于后端，不设置 `NEXT_PUBLIC_` 等公开前缀。不要把环境变量注入静态页面。预览部署默认不连接生产密钥或生产数据库；如需预览，使用独立 Neon 分支、独立邀请码与签名密钥，并将 `APP_ORIGIN` 设置为该预览的固定 HTTPS 地址。生产站点只接受一个正式域名，随机预览域名的 API 被拒绝是预期行为。

配置变更后重新部署。更换域名会使浏览器历史按新域名独立保存，并需要重新输入邀请码。更换签名密钥会使所有旧登录失效。删除邀请码后旧会话立即失效；恢复相同邀请码沿用旧额度。

## 4. 体验规则与数据库行为

| 项目 | 默认值 | 环境变量 |
| --- | --- | --- |
| 每个邀请码每日次数 | 5 | `TAROT_INVITE_DAILY_LIMIT` |
| 每个邀请码累计次数 | 20 | `TAROT_INVITE_TOTAL_LIMIT` |
| 全站每日次数 | 100 | `TAROT_DAILY_LIMIT` |
| 全站累计次数 | 1000 | `TAROT_TOTAL_LIMIT` |
| 每邀请码每分钟生成请求 | 2 | `TAROT_REQUESTS_PER_MINUTE` |
| 全站同时生成数量 | 3 | `TAROT_CONCURRENT_LIMIT` |
| 单次输入字符数 | 20000 | `TAROT_MAX_INPUT_CHARS` |
| 单次输出 token | 2048 | `TAROT_MAX_OUTPUT_TOKENS` |

每日次数在北京时间零点更新，使用数据库时钟。累计额度不重置。通过校验并获准调用模型前，以短事务扣次并占用名额；上游超时或失败也计次，重试另计。输入无效、额度耗尽、频率或并发超限不扣生成次数。

数据库中只锁一条运行状态记录，适合最多 100 个邀请码的低并发体验。所有实例共享同一记录，事务完成后才调用模型，不在模型等待期间持锁。请求正常结束前释放名额；异常中断的名额在 120 秒后可回收。函数最长 90 秒、模型请求超时 60 秒，回收时间晚于两者。旧请求不能释放后来请求的名额。高流量时再拆分数据表或引入专门的限流存储。

登录按平台提供的地址执行每分钟 10 次、全站每分钟 60 次限制；同一出口网络的访客共享地址限制。Vercel 入口只信任平台覆盖的 `x-vercel-forwarded-for`，不使用访客自填的代理地址。[平台请求头说明](https://vercel.com/docs/headers/request-headers)

数据库缺失、损坏、连接或写入失败时停止调用模型，不输出底层连接信息。服务不会自动重建被删除的额度记录。初始化检查失败后会在后续请求中重试，数据库恢复后无需重新部署；修改 Vercel 环境变量仍需重新部署。

`/healthz` 失败时返回安全的 `code`，不包含密码、连接串、主机名或底层错误原文：`database_authentication_failed` 表示核对数据库用户和密码；`database_table_missing` / `database_state_missing` 表示在连接串对应的分支与数据库中执行初始化脚本；`database_host_unreachable` 表示核对连接串主机地址；`database_tls_failed` 表示检查 TLS 连接配置；`database_permission_denied` 表示数据库用户权限不足；`storage_unavailable` 表示其他存储故障，不能仅凭它认定密码或初始化有误。

## 5. 上线检查

1. 构建执行全部测试，通过后才发布。
2. 访问正式域名的 `/healthz`，应返回 `{"status":"ok"}`；它会检查数据库当前状态，不显示配置。
3. 打开首页，输入邀请码，完成一次抽牌和 AI 解读。
4. 验证刷新与退出后再次登录不重置次数；更换设备使用同一邀请码也共享额度。
5. 验证连续追问的频率限制和每日额度提示。
6. 重新部署一次，确认累计次数仍保留。

本机可以复制 `.env.example` 为 `.env`，填入数据库与模型配置后运行 `npm run check:deployment`，该命令检查数据库但不调用模型。若要本机启动验证，使用 `APP_ORIGIN=http://127.0.0.1:3000`；Vercel 正式配置必须使用 HTTPS。

本地测试使用 PGlite（PostgreSQL 的 WASM 版本）验证真实 SQL、迁移、回滚和多个存储对象共享状态；单连接测试不能替代 Neon 多连接行锁、Vercel 路由、TLS 和真实模型连接的线上验收。仓库适配完成不等于云资源已创建或网站已发布。

## 6. 原文件额度迁移与运维

这套流程用于新建体验版。若已有文件模式的真实使用记录，不能直接切换到空数据库，否则累计额度会重新开始。应先暂停旧服务、备份原 `usage.json`，将其 `version`、`global`、`invites` 导入数据库状态并加入空的 `rates`、`leases`，核对后再切换；原文件不能包含测试额度。当前不提供自动导入工具。

定期备份数据库额度。恢复较早的备份也会回退次数。不要删除状态表、清空记录或更换成空数据库来解决连接问题。发生用量异常时先撤销邀请码或降低限额，并在模型平台设置预算上限；次数限制不等于固定金额上限。
