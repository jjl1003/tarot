import { CARDS, CARD_MAP } from "./cards.js";
import { SPIRIT_REFERENCES } from "./spirit-references.js";

// Product personalities, not claims about a universally agreed tarot tradition.
const traits = [
  ["好奇而轻盈", "尚未尝试的可能与迈出第一步的顾虑", "如果先试一小步，你最想试什么？"],
  ["清晰而主动", "手中已有的资源、意图与可采取的行动", "你已经拥有但还没使用的资源是什么？"],
  ["安静而敏锐", "未被说出的感受、直觉与信息缺口", "哪些是你知道的，哪些只是你隐约感觉到的？"],
  ["温暖而丰沛", "真实需要、照顾与付出是否得到滋养", "怎样的照顾也能把你自己包括进去？"],
  ["稳重而明确", "责任、边界与能否持续的安排", "什么约定会让这件事更稳定？"],
  ["耐心而善于引导", "习惯背后的信念、共同价值与外界期待", "这是你认同的选择，还是别人教你应当如此？"],
  ["真诚而重视关系", "选择中的价值取舍、双方意愿与一致性", "这个选择最需要忠于你的哪一种价值？"],
  ["坚定而有方向感", "目标、推进的力量与彼此冲突的方向", "你想抵达哪里，什么正在把你拉向别处？"],
  ["温柔而坚定", "情绪的容纳、耐心与不靠压抑维持的勇气", "怎样表达需要，既不压抑自己也不伤害别人？"],
  ["沉静而深入", "自己的判断、独处的需要与尚未想清的部分", "暂时放下别人的意见，你自己的答案是什么？"],
  ["开阔而灵活", "变化的周期、可控范围与对时机的适应", "变化里哪些由你决定，哪些需要你调整应对？"],
  ["客观而清楚", "事实与猜测的区别、责任和互惠", "如果只看已经发生的事，你会怎样判断？"],
  ["耐心而善于换位", "僵局中的另一种视角、暂停与付出的代价", "换一个立场看，什么会变得不同？"],
  ["坦率而尊重告别", "已经结束的部分、舍不得放下的旧模式与转变", "你想保留的东西，是否仍然适合现在的你？"],
  ["平和而细致", "不同需要的协调、节奏与可持续的分寸", "怎样调整一点，能让双方都更容易继续？"],
  ["直接而不羞辱", "欲望、依赖、交换的代价与自主选择", "你想要这件事本身，还是它带给你的某种确认？"],
  ["直截了当而保持关照", "事实与预期的冲突、脆弱的假设和需要重建的部分", "如果一个原有假设不成立，你需要重新确认什么？"],
  ["真诚而带着希望", "修复的条件、真实愿望与可以恢复的信任", "什么小变化会让你重新感到有希望？"],
  ["细腻而保留判断", "不确定中的感受、投射与需要澄清的信息", "哪一种担忧有事实支持，哪一种还需要确认？"],
  ["明快而具体", "清晰的表达、已经有效的互动与真实的快乐", "什么时刻让你最自在，那时有什么不同？"],
  ["坦诚而善于回看", "重复的模式、已经发生的变化与愿意承担的选择", "这一次，你希望怎样回应曾反复出现的问题？"],
  ["完整而有条理", "整体关联、阶段的完成与下一步的衔接", "哪些已经完成，哪些仍需要一个交代？"],
];
export const SPIRITS = Object.fromEntries(traits.map(([voice, focus, question], i) =>
  [`m${i}`, Object.freeze({ voice, focus, question })]));
export const SPIRIT_STORE = "tarot.spirit.v1";
export const MAJOR_IDS = CARDS.filter((c) => SPIRITS[c.id]).map((c) => c.id);

export function validSpirit(p) {
  return !!(p && p.version === 1 && typeof p.id === "string" && p.id.length &&
    typeof p.name === "string" && p.name.trim().length && p.name.length <= 40 &&
    typeof p.createdAt === "string" && Number.isFinite(Date.parse(p.createdAt)) &&
    Array.isArray(p.order) && p.order.length === 22 && new Set(p.order).size === 22 &&
    p.order.every((id) => Object.hasOwn(SPIRITS, id)) &&
    (p.cardId === null || p.order.includes(p.cardId)));
}
export function createSpirit(order) {
  const p = { version: 1, id: crypto.randomUUID(), name: "我的月下牌", createdAt: new Date().toISOString(), order: [...order], cardId: null };
  if (!validSpirit(p)) throw Error("牌灵需要完整的 22 张大阿卡纳");
  return p;
}
export function chooseSpirit(p, index) {
  if (!validSpirit(p) || p.cardId !== null || !Number.isInteger(index) || index < 0 || index >= 22)
    throw Error("请从尚未翻开的牌中选择一张");
  return { ...structuredClone(p), cardId: p.order[index] };
}
export function renameSpirit(p, name) {
  const n = { ...structuredClone(p), name: name.trim() };
  if (!validSpirit(n)) throw Error("请为这副牌起一个 1 至 40 字的名字");
  return n;
}
export function saveSpirit(storage, p) {
  if (!validSpirit(p)) throw Error("牌灵档案无效");
  storage.setItem(SPIRIT_STORE, JSON.stringify(p));
}
export function loadSpirit(storage) {
  try {
    const p = JSON.parse(storage.getItem(SPIRIT_STORE));
    return validSpirit(p) ? p : null;
  } catch { return null; }
}
export function spiritContext(p) {
  if (!validSpirit(p) || p.cardId === null) return null;
  const reference = SPIRIT_REFERENCES[p.cardId];
  return {
    牌灵: CARD_MAP[p.cardId].name,
    ...SPIRITS[p.cardId],
    性格依据: {
      牌灵参考: { 主题: reference.practiceTheme, 章节: reference.practiceSection, 来源: reference.practiceSource },
      牌义参考: reference.cardBasis,
      本站转译: reference.rationale,
      说明: reference.attribution,
      资料版本: reference.version,
    },
  };
}
