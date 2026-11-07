import { MEANINGS } from "./meanings.js";

export const SPIRIT_REFERENCE_VERSION = "2026-11-07.1";
export const SPIRIT_REFERENCE_NOTE = "牌灵实践参考与基础牌义分开列出；表达方式、关注角度和示例追问为本站转译设计，并非原作者原话或跨流派统一标准。";
export const SPIRIT_PRACTICE_SOURCE = Object.freeze({
  title: "牌灵，认识你的塔罗占卜伙伴",
  author: "林詣晉",
  publisher: "017 Cafe",
  url: "https://017cafe.com/main_card/",
  checkedAt: "2026-11-07",
  kind: "现代牌灵实践参考",
});
// Minimal thematic labels for the article's 22 sections; not a reproduction of the article.
// Rationales below are our own product-design decisions grounded in the linked card meanings.
const foundations = [
  ["轻盈", "由新起点与开放探索，设计为轻盈的表达；鼓励小范围尝试，不鼓励忽视风险。"],
  ["专注", "由意志、能力与资源运用，设计为先厘清目标，再寻找可以落实的行动。"],
  ["静默", "由直觉与内在声音，设计为安静观察感受；将信息缺口保留为问题，不冒充知道秘密。"],
  ["滋养", "由照料、创造与丰盛，设计为关注需要是否得到滋养，并检查过度付出。"],
  ["秩序", "由结构、责任与纪律，设计为稳重地讨论边界和安排；明确不等于替用户作主。"],
  ["传承", "由教育、传统与信念，设计为引导用户理解既有规则和共同价值，再确认是否认同。"],
  ["真诚", "由联结、伙伴与价值选择，设计为真诚地探讨双方意愿，不推定他人的内心。"],
  ["自律", "由方向与意志，设计为聚焦目标、分辨可控部分；不把推进误写成必须强硬。"],
  ["慈悲", "由勇气、同理与内在力量，设计为温和而坚定地面对情绪，同时保留个人界限。"],
  ["内省", "由独处与寻找自我，设计为深入整理自己的判断；不鼓励长期隔绝支持。"],
  ["流转", "由变化与周期，设计为留意时机和可调整的应对；不把偶然解释成命定保证。"],
  ["公平", "由事实、责任与公平，设计为区分证据和猜测，要求判断能被核对。"],
  ["换位", "由等待、暂停与视角转换，设计为先换位理解，再检视付出的意义。"],
  ["更新", "由结束与转化，设计为坦率讨论告别旧模式；不推断现实死亡或强迫断绝关系。"],
  ["调和", "由适度、耐心与协调，设计为细致地调整节奏，而非一味劝用户忍让。"],
  ["依附", "由欲望、依赖与束缚，设计为直问动机和代价；直接是本站的表达选择，不等于羞辱。"],
  ["破旧", "由突变与旧结构瓦解，设计为检查脆弱假设与重建条件，不预告具体灾祸。"],
  ["希望", "由修复与希望，设计为寻找可以支撑信心的小变化，而非保证愿望成真。"],
  ["潜识", "由不确定、直觉与迷惑，设计为细腻地分辨感受与事实，不自称能读心。"],
  ["喜悦", "由活力、快乐与清晰，设计为明快具体地看见已有进展，不强求积极。"],
  ["觉醒", "由回顾与重新评估，设计为辨认反复模式，形成新的回应而非苛责用户。"],
  ["整合", "由完成与整体关联，设计为整理已完成的部分，再明确下一阶段的衔接。"],
];
export const SPIRIT_REFERENCES = Object.fromEntries(foundations.map(([practiceTheme, rationale], i) => {
  const id = `m${i}`, card = MEANINGS[id];
  return [id, Object.freeze({
    version: SPIRIT_REFERENCE_VERSION,
    practiceTheme,
    practiceSection: `${i} · ${card.source.englishName}`,
    practiceSource: SPIRIT_PRACTICE_SOURCE,
    cardBasis: Object.freeze({ theme: card.theme, keywords: Object.freeze([...card.upright.keywords]), source: card.source }),
    rationale,
    attribution: SPIRIT_REFERENCE_NOTE,
  })];
}));
