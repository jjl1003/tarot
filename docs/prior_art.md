# 在线抽牌与 AI 解读 Agent：竞品调研与 MVP 建议

调研日期：2026 年 11 月 6 日。

调研范围：按“塔罗牌在线抽取＋AI 解读”筛选了 4 个 GitHub 项目，查看 README、核心文件和公开 Issues；有具体讨论的，也阅读了作者回复。以下属于静态代码分析，未逐个部署验证。仓库内容与 Issues 状态可能在调研后发生变化。

核心建议：以 TarotWhisper 为主要交互参考，借鉴 tarot-web 的结构化输出；MVP 先做好“提问→抽牌→解读→追问→反馈”这一条闭环。

## 1. 四个项目，分别值得学什么

| 项目 | 定位 | 最值得参考 | 主要局限 |
|---|---|---|---|
| [TarotWhisper](https://github.com/J-York/TarotWhisper) | 中文对话式塔罗 Agent | 牌阵选择、抽牌、流式解读、追问的完整编排 | 随机抽牌与补牌逻辑需要改进 |
| [tarot-web](https://github.com/Theproudcold/tarot-web) | 结构化解读与多阶段协作 | 输出契约、阶段反馈、失败降级 | 当前目录与启动配置存在不一致 |
| [Emily Tarot](https://github.com/msull/emilytarot) | Python／Streamlit 对话原型 | 引导提问、独立抽牌、会话保存 | 流程依赖模型输出特定文本，比较脆弱 |
| [chatgpt-tarot-divination](https://github.com/dreamhunter2333/chatgpt-tarot-divination) | 中文多类型占卜应用 | 快速部署、流式输出、模块化扩展 | 塔罗模块主要靠模型“模拟抽牌”，对话能力弱 |

### 1.1 TarotWhisper：最接近目标 Agent

README 描述了完整牌组、多牌阵、对话式抽牌、追问和本地历史。

核心文件：

- [`lib/agent/agentTurn.ts`](https://github.com/J-York/TarotWhisper/blob/main/lib/agent/agentTurn.ts)：首轮是“模型选牌阵→程序抽牌→模型解读”；追问是“判断直接回答还是补牌→生成回答”。
- [`lib/api/prompts.ts`](https://github.com/J-York/TarotWhisper/blob/main/lib/api/prompts.ts)：把问题、牌位、正逆位、关键词、基础牌义一起交给模型；不同牌阵有不同解读要求。
- [`lib/readingStorage.ts`](https://github.com/J-York/TarotWhisper/blob/main/lib/readingStorage.ts)：保存解读与已完成的追问，支持查看和删除。

**可以学习：**把 Agent 做成有明确步骤和状态的流程；重新生成解释时，复用已经确定的牌面。用户不应因为一次网络重试就换一副牌。

**需要改进：**[`draw.ts`](https://github.com/J-York/TarotWhisper/blob/main/lib/tarot/draw.ts) 使用随机比较器排序来洗牌，不能保证均匀随机；补牌函数也没有接收已抽牌列表，因此无法排除与原牌阵重复的牌。我们应使用标准洗牌算法，并明确“是否允许重复、补牌是否排除已抽牌”的规则。

**Issues 情况：**本次读取的公开开放 Issues 列表为空，缺少可用于判断实际使用问题的讨论样本，不能据此认为项目已经稳定。

### 1.2 tarot-web：学习如何让解读结果稳定、可展示

这个项目既提供单次生成，也提供“起稿→复核→定稿”的三阶段生成。README 强调结构化解读和实时阶段反馈。[README](https://github.com/Theproudcold/tarot-web/blob/main/README.md)

核心文件：

- [`readingContract.js`](https://github.com/Theproudcold/tarot-web/blob/main/apps/web/src/lib/readingContract.js)：定义摘要、逐牌解释、建议、追问等字段，并为缺失内容补默认值；还尝试过滤“相信自己”“顺其自然”等泛泛表达。
- [`orchestrator.js`](https://github.com/Theproudcold/tarot-web/blob/main/apps/api/server/ai/orchestrator.js)：多阶段失败后退到单次生成，再失败则返回模拟解读。
- [`readingApi.js`](https://github.com/Theproudcold/tarot-web/blob/main/apps/web/src/lib/readingApi.js)：处理流式事件、超时，以及前端本地回退。

**可以学习：**先约定解读结果的结构，再做页面。逐牌解释与整副牌的综合解释分开，才能检查是否漏牌、错位，以及建议是否具体。

**需要谨慎借鉴：**

- 多一次模型复核是否能提升质量，需要实际对照评测，不能只凭“多 Agent”判断。
- 模型失败后的模板解读必须明确标注来源。该项目有来源标签设计，这一点值得保留。
- 调研时的 [`package.json`](https://github.com/Theproudcold/tarot-web/blob/main/package.json) 仍指向根目录 `server/index.js`，实际入口已在 `apps/api/server/`；部分文件还保留旧相对路径。静态检查发现配置与目录不一致，不宜直接当成可运行底座。

**Issues 情况：**本次读取的公开开放 Issues 列表为空。上述问题是代码检查发现，并非社区已确认的缺陷。

### 1.3 Emily Tarot：用很小的原型验证体验

README 将其定位为学习 Streamlit 与大模型的实验，支持在线抽牌和用户手动输入实体牌结果。[README](https://github.com/msull/emilytarot/blob/main/README.md)

核心文件：

- [`streamlit_app.py`](https://github.com/msull/emilytarot/blob/main/src/streamlit_app.py)：会话状态、程序抽牌、防重复、模型调用与文件保存。
- [`utils/messages.py`](https://github.com/msull/emilytarot/blob/main/src/utils/messages.py)：角色设定、引导问题、抽牌指令及解读要求。

**可以学习：**先让用户说清楚处境，再开始解读；抽牌由程序完成，解释由模型完成。实体牌输入也提供了一个后续入口。

**Issues 的关键教训：**

- [Issue #1](https://github.com/msull/emilytarot/issues/1)：用户希望增加凯尔特十字等牌阵。
- [Issue #2](https://github.com/msull/emilytarot/issues/2)：用户反馈会话意外结束。作者解释，应用靠模型是否继续输出 `QUESTION:` 或抽牌指令判断流程是否结束，模型遗漏这些标记，就会被当成结束。

流程状态应由程序维护，模型只返回经过校验的动作或内容。换更强的模型可以缓解格式问题，但无法替代可靠的状态管理。

### 1.4 chatgpt-tarot-divination：学习部署和模块组织

README 提供多种部署方式，并包含流式输出、历史记录和多种占卜模块。[README](https://github.com/dreamhunter2333/chatgpt-tarot-divination/blob/main/README.md)

核心文件：

- [`src/divination/tarot.py`](https://github.com/dreamhunter2333/chatgpt-tarot-divination/blob/main/src/divination/tarot.py)：塔罗提示词要求模型自行抽三张随机牌，然后解释。
- [`src/chatgpt_router.py`](https://github.com/dreamhunter2333/chatgpt-tarot-divination/blob/main/src/chatgpt_router.py)：统一处理模块分发、模型配置、限流与流式返回。

**可以学习：**共用一套模型调用与错误处理，每种玩法只定义自己的输入和解释方式，后续扩展比较方便。

**Issues 揭示的三个真实需求：**

- [#72：只能进行一轮对话？](https://github.com/dreamhunter2333/chatgpt-tarot-divination/issues/72)——作者明确回复，当时只有一次 AI 调用，没有做成对话。
- [#80：其他 API Key 报 network error](https://github.com/dreamhunter2333/chatgpt-tarot-divination/issues/80)——兼容接口与配置体验容易成为使用障碍。
- [#77：希望增加会员与支付](https://github.com/dreamhunter2333/chatgpt-tarot-divination/issues/77)——这是功能诉求，尚不能证明存在付费意愿。

我们不应照搬“让模型自行随机抽牌”的做法：它缺少独立、可核验的抽牌过程，也不方便在追问和重试时保持一致。

## 2. 可以拓展的方向

以下是基于上述实现与 Issues 提出的产品建议，并不代表已经验证的市场空白。

| 方向 | 可以具体做什么 | 优先级 |
|---|---|---|
| 有上下文的追问 | 用户问“这具体对应什么”，系统沿用原问题与原牌阵回答，默认不重新抽牌 | MVP |
| 更具体的解读 | 每张牌说明“基础牌义→在这个牌位的含义→如何关联你的问题”，最后给出可执行的小行动 | MVP |
| 问题澄清 | 对“我最近怎么样”这类模糊输入，最多补问一次，帮助用户确定主题 | MVP 简化版 |
| 个性化记忆 | 用户主动选择记住背景、偏好与正在关注的主题，并能查看、删除 | 第二阶段 |
| 行动与复盘 | 保存用户自己选定的行动，之后自愿回来记录是否有帮助 | 第二阶段 |
| 教学模式 | 点开解释依据，了解某张牌为何在不同牌位有不同含义 | 第二阶段 |
| 分享与视觉体验 | 生成牌阵分享图、轻量翻牌动画，分享时默认隐藏个人问题 | 后续 |

推荐第一版定位为：**帮助用户围绕一个具体困惑完成一次有仪式感的自我梳理。**

例如用户问“我是否该换工作”，产品可以帮助其梳理顾虑、可控制的因素和下一步行动。这样更容易判断解读是否有帮助，也能避免产品陷入不断追求“预测准确”的方向。

## 3. MVP 最该搭的核心骨架

建议只支持一种固定三张牌阵，例如“现状／阻碍／建议”，先把一次体验跑完整：

```text
输入具体问题
    ↓
必要时澄清一次
    ↓
程序抽取三张牌，保存牌面与正逆位
    ↓
模型结合问题、牌位和基础牌义生成解读
    ↓
沿用原牌阵追问
    ↓
保存结果、收集反馈
```

### 3.1 模块范围

| 核心模块 | 第一版做到什么程度 |
|---|---|
| 牌库与牌阵 | 78 张牌的固定 ID、名称、图片、正逆位基础牌义；一种三张牌阵 |
| 抽牌引擎 | 标准洗牌、不重复抽牌；抽牌结果先保存，重试解读时不重新抽 |
| 会话状态 | 明确区分待抽牌、解读中、解读完成、追问中、失败；流程由程序控制 |
| 解读生成 | 固定输出：摘要、逐牌解释、综合关联、行动建议；校验字段完整性 |
| 追问能力 | 携带原问题、牌面、首轮解读和必要对话；MVP 暂不自动补牌 |
| 失败处理 | 展示等待状态；超时能重试；保留牌面与已完成结果 |
| 历史与反馈 | 浏览器本地历史、删除入口；反馈可选“太空泛／没结合问题／解释矛盾／有帮助” |
| 线上运行 | 服务端保存模型密钥，限制调用次数和输出长度，记录耗时、错误及版本 |

### 3.2 最小数据关系

**一次抽牌记录 → 多次解读或追问 → 对应的用户反馈。**

至少保留：

- `reading_id`
- 原问题
- 牌阵
- 牌 ID、牌位、正逆位
- 解读内容
- 追问
- 模型与提示词版本
- 用户反馈

这样以后修改提示词，才能知道哪些问题改善了；仅仅保存聊天记录，还不足以形成改进闭环。

### 3.3 第一版暂不做

多 Agent 审稿、向量数据库、多套牌、复杂十张牌阵、会员支付、自动补牌和长期用户画像。对于固定牌库，直接按牌 ID 取基础牌义即可。

### 3.4 最小验收标准

上线前，建议用约 20—30 个样例做一次小规模验收，重点检查：

- **牌面一致性：**有没有说错牌名、正逆位或牌位。
- **问题相关性：**换一个用户问题，回答是否仍然几乎通用。
- **建议具体性：**用户能否说出自己接下来可以做什么。
- **追问连续性：**有没有遗忘、篡改原牌面，或无故重新抽牌。
- **失败可恢复性：**断网、超时、刷新后，牌面与已完成结果能否保留。

## 4. 推荐参考顺序

优先精读 TarotWhisper 的回合编排，再参考 tarot-web 的结构化输出与失败处理。优先打磨“固定牌面下的具体解读与连续追问”，这两项最直接决定产品能否超出一次性抽牌页面。
