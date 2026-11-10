# 控制台字段与排错

## 引导的输出方式

每次发出一个当前可执行步骤，包含可点击网页、进入路径、具体字段表、完成标志和需要用户反馈的非敏感信息。例如：“打开 Vercel 导入页，按下表配置；填好后告诉我是否出现构建错误，不要发送密钥。”用户可手动填写，也可授权可用的浏览器/连接工具代填普通字段。没有控制台访问能力时坦诚说明，继续提供网页指导。

项目链接只有在实际获知 project/team/branch 标识后才构造；不要把猜出的深层 URL 当成可用链接。字段名称以当前 UI 为准。

## GitHub

入口：[新建仓库](https://github.com/new)。

| 字段 | 填写依据 |
| --- | --- |
| Owner / Repository name | 用户账号及本次项目名；已有仓库直接使用 |
| Visibility | 尊重现有选择；无需为 Vercel 强制公开 |
| Initialize repository | 推送已有本地仓库时通常不额外生成文件，避免不必要的历史冲突 |

推送前检查忽略规则、待提交文件与现有远程；不将工作区所有改动一起提交。确认 Vercel GitHub 授权能读取目标仓库，免费方案对仓库归属/组织协作的支持需当次核对。

## Neon

入口：[控制台](https://console.neon.tech/)。进入项目的 Connect 或 SQL Editor。

| 字段 | 填写依据 |
| --- | --- |
| Project name | 项目名，例如 `my-web-tool`，只是命名示例 |
| Plan | 当前可用的 Free，确认无付费升级 |
| Region | 与实际后端函数接近，按可用列表选择 |
| Branch / Database / Role | 记录实际选择；初始化和运行必须指向同一目标 |
| Connection pooling | 普通服务端 PostgreSQL 运行连接通常开启；迁移按工具要求 |
| Connection string | 用户直接复制进 Vercel 对应变量，不在聊天展示 |

## Vercel

入口：[导入](https://vercel.com/new)，后续从 [控制台](https://vercel.com/dashboard) 进入 Project → Settings 的 Build、Environment Variables、Domains 等页面。

| 字段 | 填写依据 |
| --- | --- |
| Git Repository / Production Branch | 实际仓库和已推送的目标分支，不假定一定叫 main |
| Project Name | 应用名；生成域名以 Domains 实际结果为准 |
| Framework Preset | 自动识别并核对；原生静态/自定义适配项目才考虑 Other |
| Root Directory | 包含当前应用的相对目录；单仓根目录通常不改 |
| Install Command | 由锁文件和包管理器决定，能用默认就保留；测试需要开发依赖时不能省略 |
| Build Command | 仓库真实构建脚本；纯静态项目可能无需构建，不填常驻 start 命令 |
| Output Directory | 实际构建产物；框架默认输出由框架管理 |
| Runtime / Node.js Version | 当前平台支持且满足依赖和 engines 的版本 |
| Function Region / Duration | 按后端需求及免费版实际可用配置，不直接照搬历史数字 |

## 环境变量字段示例

下表用于说明填法，实际部署仅列出代码真正读取的名称；不存在的变量不要求填写。

| 变量 | 填什么或去哪里取 | 范围 | 敏感 |
| --- | --- | --- | --- |
| `DATABASE_URL` | Neon Connect 的运行时连接串 | Production | 是，直接填控制台 |
| `DIRECT_URL` | 仅迁移工具确实需要时取 direct 连接 | 运行迁移的隔离环境 | 是 |
| `APP_ORIGIN` | Domains 中实际 HTTPS 根地址，仅应用读取时填写 | Production | 否 |
| 应用自有 API Key 变量 | 第三方服务控制台，变量名从代码提取 | Production 服务端 | 是 |
| 应用自有会话密钥变量 | 本机可靠随机生成，避免在日志/聊天输出 | Production 服务端 | 是 |

## 排错顺序

先区分构建失败、页面或路由错误、函数错误、数据库错误、业务错误，取脱敏日志和失败请求，不索取完整环境变量截图。

| 现象 | 优先核对 | 修复后的验证 |
| --- | --- | --- |
| 导入时找不到仓库 | GitHub 登录账号、仓库授权与归属、方案限制 | 导入页能选择目标仓库 |
| 构建失败 | 首条有效错误、Root Directory、锁文件、运行时、构建命令、开发依赖 | 本地同条件构建和新部署日志 |
| 首页/资源 404 | 输出目录、框架识别、静态路径 | 首页与资源请求 |
| 刷新子路径 404 | SPA 回退是否需要及 API 路由是否被覆盖 | 直接访问深层路由与 API |
| 函数无法启动 | 服务入口适配、依赖打包、必填变量、运行时 | 函数日志与最小请求 |
| 数据库认证或连接失败 | 变量名及环境、Connect 目标、role/密码、TLS、池化方式 | 脱敏连接检查，保留 TLS |
| 表/记录不存在 | 迁移是否执行、是否在同一 branch/database/schema、权限 | 读取预期结构和初始化记录 |
| TLS 错误 | 控制台原始连接参数、驱动配置与官方连接文档 | 证书验证开启下正常连接 |
| 保存后数据丢失 | 是否仍写临时文件/内存、事务是否提交、环境隔离 | 换会话并重新部署后读取 |
| 登录/跨域失败 | 生产域名、origin、回调路径、cookie 安全属性 | 真实生产域名完整登录操作 |
| 改变量仍报同样错误 | 修改范围和新部署是否使用新配置 | 核对部署时间与环境，勿输出变量值 |
| 超时或首次请求很慢 | 冷启动、地区、SQL与上游耗时、当前函数时限 | 一次有界请求；不靠无限重试 |

项目自定义错误码需从代码/文档解释，不能把一处应用的错误码推广给所有项目。

## 来源项目经验的适用边界

本技能提炼自 tarot 项目的 Vercel + Neon 部署文档和配置。该例采用 `Other`、`public`、`api/index.mjs`、构建时 `npm test`、独立数据库初始化、生产 origin 和服务端模型密钥。

这些是具体项目的决策，不是通用默认值。`TAROT_*` 变量、邀请码额度、`tarot_runtime` 表、`/healthz`、函数时长和模型名只适用于对应实现。部署 tarot 时重新读取该仓库的 `docs/DEPLOY.md`、`.env.example`、`vercel.json` 和实际代码；技能无需依赖原仓库存在即可部署其他应用。
