'use strict';

/* 配料用量规范化：把英制 / 英文单位换算成中文公制，原文保留在括号里对照。
   用法：
     node tools/normalize-units.js --dry    只看报告，不改文件
     node tools/normalize-units.js          写回 素材/index.zh.json

   输出格式：材料名（公制用量；原 原文档）
   例如：淡朗姆酒（60–90 毫升；原 2-3 oz）、糖（10 毫升；原 2 tsp）
   原本就是中文公制的行不加「原」：石榴糖浆（5 毫升）

   换算依据（见 PRO.md 第 5 节）：
     1 oz = 29.57 ml（调酒惯例取 30）  1 cl = 10 ml     1 ml = 1 ml
     1 tsp = 4.93 ml                  1 tbsp = 14.79 ml 1 cup = 236.59 ml
     1 shot / jigger = 44.36 ml       1 pony = 29.57 ml  1 barspoon = 5 ml
     1 dash = 0.92 ml                 1 splash = 5 ml    1 drop = 0.05 ml
     1 pinch = 0.3 g                  1 cube（方糖）= 4 g
   计数量词（个/片/块/滴/份/瓣/根/枝/颗/粒/束/杯/罐/瓶/勺）不做数值换算。
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '素材', 'index.zh.json');
const DRY = process.argv.indexOf('--dry') !== -1;

/* ---------- 换算表：单位 -> 处理方式 ---------- */
/* kind: 'ml' | 'g' | 'count' | 'text' */
const UNITS = [
  // 体积：英制 -> 毫升
  { keys: ['fluid ounces', 'fluid ounce', 'fl oz', 'fl. oz', 'floz'], kind: 'ml', factor: 29.573, label: '毫升' },
  { keys: ['ounces', 'ounce', 'oz'], kind: 'ml', factor: 29.573, label: '毫升' },
  { keys: ['milliliters', 'millilitres', 'milliliter', 'millilitre', 'ml'], kind: 'ml', factor: 1, label: '毫升' },
  { keys: ['centiliters', 'centilitres', 'centiliter', 'centilitre', 'cl', 'c.l'], kind: 'ml', factor: 10, label: '毫升' },
  { keys: ['liters', 'litres', 'liter', 'litre'], kind: 'ml', factor: 1000, label: '毫升' },
  { keys: ['tablespoons', 'tablespoon', 'tbsp', 'tblsp', 'tbs'], kind: 'ml', factor: 14.787, label: '毫升' },
  { keys: ['teaspoons', 'teaspoon', 'tsp'], kind: 'ml', factor: 4.929, label: '毫升' },
  { keys: ['barspoons', 'barspoon'], kind: 'ml', factor: 5, label: '毫升' },
  { keys: ['jiggers', 'jigger'], kind: 'ml', factor: 44.36, label: '毫升' },
  { keys: ['shots', 'shot'], kind: 'ml', factor: 44.36, label: '毫升' },
  { keys: ['ponies', 'pony'], kind: 'ml', factor: 29.573, label: '毫升' },
  { keys: ['cups', 'cup'], kind: 'ml', factor: 236.588, label: '毫升' },
  { keys: ['splashes', 'splash'], kind: 'ml', factor: 5, label: '毫升' },
  { keys: ['dashes', 'dash'], kind: 'ml', factor: 0.92, label: '毫升' },
  { keys: ['drops', 'drop'], kind: 'ml', factor: 0.05, label: '毫升' },
  { keys: ['gallons', 'gallon', 'gal'], kind: 'ml', factor: 3785.41, label: '毫升' },
  { keys: ['quarts', 'quart', 'qt'], kind: 'ml', factor: 946.35, label: '毫升' },
  { keys: ['pints', 'pint', 'pt'], kind: 'ml', factor: 473.18, label: '毫升' },
  { keys: ['inches', 'inch'], kind: 'ml', factor: 2.54, label: '厘米' },
  { keys: ['liters', 'litres', 'liter', 'litre', 'l'], kind: 'ml', factor: 1000, label: '毫升' },
  // 重量
  { keys: ['pounds', 'pound', 'lbs', 'lb'], kind: 'g', factor: 453.592, label: '克' },
  { keys: ['kilograms', 'kilogram', 'kg'], kind: 'g', factor: 1000, label: '克' },
  { keys: ['deciliters', 'decilitres', 'deciliter', 'decilitre', 'dl'], kind: 'ml', factor: 100, label: '毫升' },
  { keys: ['fifths', 'fifth'], kind: 'ml', factor: 750, label: '毫升' },
  { keys: ['grams', 'gram', 'gr', 'g'], kind: 'g', factor: 1, label: '克' },
  { keys: ['pinches', 'pinch'], kind: 'g', factor: 0.3, label: '克' },
  { keys: ['cubes', 'cube'], kind: 'g', factor: 4, label: '克', note: '块' },
  { keys: ['scoops', 'scoop'], kind: 'g', factor: 15, label: '克', note: '大勺' },
  // 计数量词
  { keys: ['slices', 'slice'], kind: 'count', label: '片' },
  { keys: ['wedges', 'wedge'], kind: 'count', label: '块' },
  { keys: ['chunks', 'chunk'], kind: 'count', label: '块' },
  { keys: ['pieces', 'piece'], kind: 'count', label: '块' },
  { keys: ['leaves', 'leaf'], kind: 'count', label: '片' },
  { keys: ['sprigs', 'sprig'], kind: 'count', label: '小枝' },
  { keys: ['stalks', 'stalk'], kind: 'count', label: '根' },
  { keys: ['cloves', 'clove'], kind: 'count', label: '瓣' },
  { keys: ['bunches', 'bunch'], kind: 'count', label: '束' },
  { keys: ['handfuls', 'handful'], kind: 'count', label: '把' },
  { keys: ['twists', 'twist'], kind: 'count', label: '条' },
  { keys: ['sticks', 'stick'], kind: 'count', label: '根' },
  { keys: ['whole'], kind: 'count', label: '个' },
  { keys: ['parts', 'part'], kind: 'count', label: '份' },
  { keys: ['measures', 'measure'], kind: 'count', label: '份' },
  { keys: ['packages', 'package', 'packs', 'pack'], kind: 'count', label: '包' },
  { keys: ['glasses', 'glass'], kind: 'count', label: '杯' },
  { keys: ['bottles', 'bottle'], kind: 'count', label: '瓶' },
  { keys: ['cans', 'can'], kind: 'count', label: '罐' },
  { keys: ['盎司', '液量盎司', '液盎司'], kind: 'ml', factor: 29.573, label: '毫升' },
  { keys: ['厘升'], kind: 'ml', factor: 10, label: '毫升' },
  { keys: ['毫升'], kind: 'ml', factor: 1, label: '毫升' },
  { keys: ['汤匙', '大勺'], kind: 'ml', factor: 14.787, label: '毫升' },
  { keys: ['茶匙', '小勺'], kind: 'ml', factor: 4.929, label: '毫升' },
  { keys: ['克'], kind: 'g', factor: 1, label: '克' },
  // 中文计数量词：每个都要有自己的 label，否则会串成第一个
  ...['片', '块', '个', '只', '颗', '粒', '瓣', '根', '枝', '束', '杯', '罐', '瓶', '份', '撮', '匙', '滴', '勺', '包', '袋', '把', '段', '条', '张', '朵', '串', '盒', '听', '扎', '桶']
    .map((k) => ({ keys: [k], kind: 'count', label: k }))
];
// 长的优先匹配（"fluid ounces" 先于 "oz"）
UNITS.sort((a, b) => b.keys[0].length - a.keys[0].length);

const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|[0-9]+(?:[.,][0-9]+)?|[一二两三四五六七八九十半½¼¾])';
const QTY_RE = new RegExp('^\\s*(' + NUM + ')\\s*(?:[~～]|–|—|-|to|or)\\s*(' + NUM + ')\\s*');
const ONE_RE = new RegExp('^\\s*(' + NUM + ')\\s*');
/* 只有数量、没有单位时，按材料给个量词 */
const BARE_NUM_RE = new RegExp('^\\s*(' + NUM + ')\\s*(?:[~～]|–|—|-|to|or)\\s*(' + NUM + ')\\s*$|^\\s*(' + NUM + ')\\s*$');
const BARE_NUM_WORD_RE = new RegExp('^\\s*(' + NUM + ')(?:\\s*(?:[~～]|–|—|-|to|or)\\s*(' + NUM + '))?\\s*([A-Za-z][A-Za-z\\-\\s,\\/]*)$');
const MATERIAL_UNITS = {
  樱桃: '颗', 马拉斯奇诺樱桃: '颗', 黑樱桃: '颗', 橄榄: '颗', 蓝莓: '颗', 草莓: '颗', 葡萄: '颗', 咖啡豆: '颗',
  丁香: '颗', 小豆蔻: '颗', 多香果: '颗', 八角: '颗', 杏: '个', 杏子: '个', 李子: '个',
  蛋清: '个', 蛋黄: '个', 鸡蛋: '个', 全蛋: '个', 蛋: '个',
  青柠: '个', 柠檬: '个', 橙子: '个', 橘子: '个', 柚子: '个', 香蕉: '个', 桃子: '个', 苹果: '个',
  梨: '个', 猕猴桃: '个', 芒果: '个', 牛油果: '个', 番茄: '个', 西红柿: '个',
  薄荷: '片', 罗勒: '片', 薄荷叶: '片', 罗勒叶: '片', 香草叶: '片', 苦艾: '片',
  冰块: '块', 碎冰: '块', 方糖: '块', 糖: '块', 菠萝: '块', 西瓜: '块', 木瓜: '块',
  柠檬片: '片', 青柠片: '片', 橙片: '片', 柠檬皮: '片', 橙皮: '片', 姜: '片', 生姜: '片',
  芹菜: '根', 胡萝卜: '根', 黄瓜: '根', 肉桂: '根', 香草: '根', 迷迭香: '枝', 百里香: '枝'
};
/* 用量后面的英文形容词/处理方式，翻成中文 */
const DESCRIPTORS = {
  large: '大', small: '小', medium: '中', big: '大', frozen: '冷冻', fresh: '新鲜', chilled: '冰镇',
  beaten: '打散', crushed: '压碎', cracked: '轻拍', chopped: '切碎', sliced: '切片', diced: '切丁',
  minced: '切末', grated: '擦碎', halved: '对半切', melted: '融化', softened: '软化', whole: '整个',
  cubed: '切块', peeled: '去皮', thin: '薄', thick: '厚', ripe: '熟', optional: '可选',
  squeeze: '挤汁', strong: '浓', cold: '冰', ground: '研磨', coarse: '粗粒', mini: '迷你',
  unsweetened: '无糖', hot: '热', warm: '温', garnish: '装饰用', room: '室温', plus: '另加',
  fill: '加至满杯', filled: '加至满杯', pods: '荚', leaves: '叶', leaf: '叶', sprig: '小枝', strip: '条',
  juiced: '榨汁', scraped: '刮取', topping: '装饰用'
};
function translateWords(s) {
  const words = String(s || '').split(/[\s,\/]+/).filter(Boolean);
  const out = words.map((w) => DESCRIPTORS[w.toLowerCase()] || DESCRIPTORS[w.toLowerCase().replace(/-$/, '')] || w);
  return out.join('，');
}

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5, '½': 0.5, '¼': 0.25, '¾': 0.75 };

/* 纯文本型用量：原文 -> 中文说法 */
const TEXT_MEASURES = [
  [/((to|by)\s*taste|按\s*(个人)?口\s*味|根\s*据\s*(个人)?口\s*味|适\s*量|少\s*量)/i, '根据个人口味'],
  [/(fill\s*to\s*top|top\s*it\s*up|top\s*up|to\s*fill|fill\s*with|fill(ed)?|full\s*glass|^top$|^to\s*top|加至满杯|8\s*分满)/i, '加至满杯'],
  [/(optional|可\s*选)/i, '可选'],
  [/(juice\s*of\s*(.+))/i, null] // 特殊：Juice of 1 → 1 个的量，榨汁
];

function numToText(s) {
  const t = String(s).trim();
  if (Object.prototype.hasOwnProperty.call(CN_NUM, t)) return String(CN_NUM[t]);
  return t.replace(',', '.');
}

/* 小数取值，用于换算 */
function numToValue(s) {
  const t = String(s).trim();
  if (Object.prototype.hasOwnProperty.call(CN_NUM, t)) return CN_NUM[t];
  if (/^\d+\s+\d+\/\d+$/.test(t)) {
    const p = t.split(/\s+/);
    return Number(p[0]) + fracValue(p[1]);
  }
  if (/^\d+\/\d+$/.test(t)) return fracValue(t);
  return Number(t.replace(',', '.'));
}
function fracValue(s) {
  const p = String(s).split('/');
  return Number(p[0]) / Number(p[1]);
}

/* 公制数值取整：>=10 取整到 5；1~10 取整到 0.5；<1 保留 1 位小数 */
function roundMetric(v) {
  if (v >= 10) return Math.round(v / 5) * 5;
  if (v >= 1) return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}
function fmtNum(v) {
  const r = roundMetric(v);
  return Number.isInteger(r) ? String(r) : String(r);
}

/* 在剩余文本开头匹配一个单位 */
function matchUnit(rest) {
  const s = rest.replace(/^[\s.]+/, '');
  for (const u of UNITS) {
    for (const k of u.keys) {
      const re = new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
      const m = re.exec(s);
      if (m) return { unit: u, raw: m[0], len: rest.length - s.length + m[0].length };
    }
  }
  return null;
}

/* 解析一段用量文本 -> { out, metric, noOriginal, tail }
   nameHint 用于「只有数字没单位」时按材料补量词 */
function convertMeasure(text, nameHint) {
  let raw = String(text || '').trim();
  if (!raw) return null;
  // 去掉 about / approximately 之类的量词前缀，以及句首动词（Add / Pour…）
  raw = raw.replace(/^\s*(about|approx\.?|approximately|roughly|around)\s+/i, '');
  raw = raw.replace(/^\s*(add|pour|put|use|mix)\s+/i, '');

  // 纯文本型
  for (const [re, label] of TEXT_MEASURES) {
    const m = re.exec(raw);
    if (!m) continue;
    if (label) return { out: label, metric: true, noOriginal: true };
    const inner = String(m[2] || '').trim();
    return { out: inner + ' 个的量，榨汁', metric: true, noOriginal: true };
  }

  // 数量（可为区间）
  let lo = null, hi = null, consumed = 0;
  let m = QTY_RE.exec(raw);
  if (m) {
    lo = numToText(m[1]); hi = numToText(m[2]); consumed = m[0].length;
  } else {
    m = ONE_RE.exec(raw);
    if (m) { lo = numToText(m[1]); consumed = m[0].length; }
  }

  // 单位
  const rest = raw.slice(consumed);
  const u = matchUnit(rest);
  const qtyText = lo === null ? '' : (hi !== null ? lo + '–' + hi : lo);

  if (!u) {
    // 只有数量、没有单位：按材料补量词（如「樱桃（1）」->「樱桃（1 颗）」）
    const unitLabel = nameHint ? MATERIAL_UNITS[String(nameHint).trim()] : null;
    if (unitLabel && BARE_NUM_RE.test(raw)) {
      return { out: (qtyText || '1') + ' ' + unitLabel, metric: false };
    }
    // 数量 + 英文形容词（如「橙子（3 large）」「草莓（8-10 ripe）」）
    const mw = BARE_NUM_WORD_RE.exec(raw);
    if (mw && nameHint) {
      const words = translateWords(mw[3]);
      const q = numToText(mw[1]) + (mw[2] ? '–' + numToText(mw[2]) : '');
      if (unitLabel) return { out: q + ' ' + unitLabel, metric: false, tail: words };
      if (words) return { out: '根据个人口味', metric: true, tail: words };
    }
    // 认不出材料，但确实是数量：用中性的「份」
    if (BARE_NUM_RE.test(raw)) return { out: (qtyText || '1') + ' 份', metric: false };
    // 纯英文处理说明（每个词都认识）：标「根据个人口味」并把说明译成中文
    if (/^[A-Za-z][A-Za-z\s&,\-]*$/.test(raw)) {
      const ws = raw.split(/[\s,]+/).filter(Boolean);
      if (ws.length && ws.every((w) => DESCRIPTORS[w.toLowerCase()])) {
        return { out: '根据个人口味', metric: true, tail: translateWords(raw) };
      }
    }
    return null;   // 认不出来就不动，交给报告人工看
  }
  const afterUnit = rest.slice(u.len);
  const uu = u.unit;

  if (uu.kind === 'text') return { out: uu.label, metric: true, noOriginal: true };

  if (uu.kind === 'count') {
    const label = uu.label || uu.keys[0];
    const q = qtyText || '1';
    return {
      out: q + ' ' + label,
      metric: !isSameUnitText(raw, q + label),
      tail: afterUnit.trim()
    };
  }

  // 数值换算
  const factor = uu.factor;
  let out;
  if (lo === null || hi !== null) {
    const a = lo === null ? 1 : numToValue(lo);
    const b = hi === null ? a : numToValue(hi);
    out = fmtNum(a * factor) + (hi === null ? '' : '–' + fmtNum(b * factor));
  } else {
    out = fmtNum(numToValue(lo) * factor);
  }
  out = out + ' ' + uu.label;
  if (uu.note) out = (qtyText || '1') + ' ' + uu.note + '，约 ' + out;   // 1 块，约 4 克
  return { out, metric: true, tail: afterUnit.trim() };
}

function isSameUnitText(a, b) {
  return String(a).replace(/\s+/g, '') === String(b).replace(/\s+/g, '');
}

/* 拆出末尾括号里的内容 */
function splitTrailingParen(s) {
  const m = /^(.*?)[（(]\s*([^（()）]*)\s*[）)]\s*$/.exec(s);
  if (!m) return null;
  return { head: m[1].trim(), inner: m[2].trim() };
}

const LOOKS_MEASURE = /\d|oz|ml|cl|tsp|tbsp|tblsp|dash|splash|part|shot|cup|cube|slice|wedge|leaf|leaves|twist|sprig|scoop|pinch|drop|jigger|pony|barspoon|glass|bottle|can|taste|top|juice|optional|毫升|克|滴|片|块|个|颗|份|杯|匙|勺|瓣|根|枝|束|罐|瓶|适量|少量|口味|盎司|厘升/i;
/* 已经规范化过的行（末尾括号里出现我们输出的中文用量），重复执行时跳过 */
const OUT_UNITS = '毫升|厘米|克|滴|颗|片|块|个|只|粒|瓣|根|枝|束|杯|罐|瓶|份|撮|匙|勺|包|袋|把|段|条|张|朵|串|盒|听|扎|桶';
const NORMALIZED_RE = new RegExp('[（(][^（()）]*(' + OUT_UNITS + '|根据个人口味|加至满杯|可选|小枝|大勺|个的量)[^（()）]*[）)]\\s*$');
/* 老写法（上一版脚本产出的）：末尾括号以「适量 / 按个人口味」开头，重跑时统一改写 */
const OLD_TASTE_RE = /^([^（()）]*)[（(](适量|按个人口味)\s*(；[^（()）]*)?[）)]$/;
/* 「做法」文案里的「适量」——源数据里仅有的 6 处，改成读得通的中文 */
const INSTRUCTION_FIXES = [
  ['按喜好加入适量牛奶', '按个人口味加入牛奶'],
  ['加入柠檬汁、适量鲜榨橙汁和大量冰块。加入大量冰块。', '加入柠檬汁，按个人口味加入鲜榨橙汁，再加大量冰块。'],
  ['加入适量水（只需适量）', '加入按个人口味分量的水'],
  ['加入甜炼乳、糖、冰块和适量水。', '加入甜炼乳、糖、冰块，水按个人口味添加。'],
  ['加入大蒜青辣椒酱和适量盐。', '加入大蒜青辣椒酱，盐按个人口味添加。'],
  ['倒入烈酒和适量酸甜混合液', '倒入烈酒和按个人口味分量的酸甜混合液']
];

const stats = { total: 0, converted: 0, keptChinese: 0, textMeasure: 0, addedShiliang: 0, skipped: 0, already: 0 };
const changed = [];
const skippedSamples = [];

/* 源数据把「适量 / 按个人口味」写进了材料名里（如「冰糖适量（根据个人口味）」），
   这里把它们从名字里清掉，只保留括号里的规范用量。 */
function stripTasteInName(s) {
  const p = splitTrailingParen(s);
  if (p) {
    const head = p.head.replace(/适量|按个人口味|根据个人口味/g, '')
      .replace(/可选\s*$/, '').replace(/[，,、\s]+$/, '').trim();
    if (!head) return s;
    return head + '（' + p.inner + '）';
  }
  if (/适量|按个人口味/.test(s)) {
    return s.replace(/适量|按个人口味/g, '').replace(/[，,、\s]+$/, '').trim();
  }
  return s;
}

function normalizeLine(line) {
  stats.total++;
  const src0 = String(line == null ? '' : line).trim();
  if (!src0) { stats.skipped++; return line; }
  const src = stripTasteInName(src0);
  if (src !== src0) { stats.textMeasure++; return src; }
  // 老写法的口味用量：统一改成「根据个人口味」，保留中文备注、丢掉英文残片
  const oldTaste = OLD_TASTE_RE.exec(src);
  if (oldTaste) {
    stats.textMeasure++;
    const head = oldTaste[1];
    const tail = String(oldTaste[3] || '').replace(/^；/, '');
    let out;
    if (/加至满杯/.test(tail)) out = '加至满杯';
    else if (/可选/.test(tail)) out = '可选';
    else {
      const cn = tail.split(/[；,，]/).map((w) => w.trim())
        .filter((w) => /[\u4e00-\u9fa5]/.test(w)).join('，');
      out = '根据个人口味' + (cn ? '；' + cn : '');
    }
    return head + '（' + out + '）';
  }
  if (NORMALIZED_RE.test(src)) { stats.already++; return line; }   // 幂等：已是规范格式

  let amount = null;
  let name = src;

  // 1) 行首就有数量（如「5毫升石榴糖浆」「2个桃子切丁」）
  const head = ONE_RE.exec(src) || QTY_RE.exec(src);
  if (head) {
    const rest = src.slice(head[0].length);
    const u = matchUnit(rest);
    if (u) {
      amount = src.slice(0, head[0].length + u.len);
      name = rest.slice(u.len).trim();
    }
  }

  // 2) 末尾括号里是用量（如「淡朗姆酒（2-3 oz）」）
  if (!amount) {
    const p = splitTrailingParen(src);
    if (p && LOOKS_MEASURE.test(p.inner)) { amount = p.inner; name = p.head; }
  }

  // 3) 没有用量 -> 看括号里是什么
  if (!amount) {
    const p = splitTrailingParen(src);
    if (p && p.inner && /^[A-Za-z][A-Za-z\s,'&\/\-]*$/.test(p.inner)) {
      // 纯英文说明：译成中文并标「根据个人口味」（如「打发奶油（Chilled）」->「打发奶油（根据个人口味；冰镇）」）
      const head = p.head.replace(/[（(，,\s]+$/, '').trim();
      const src2 = p.inner.replace(/^[,\s]+/, '');
      const words = translateWords(src2);
      if (head) {
        stats.addedShiliang++;
        return head + '（根据个人口味' + (words !== src2 ? '；' + words : '') + '）';
      }
    }
    if (/[\u4e00-\u9fa5]/.test(src) && src.indexOf('（') === -1 && src.indexOf('(') === -1) {
      stats.addedShiliang++;
      return src + '（根据个人口味）';
    }
    stats.skipped++;
    if (skippedSamples.length < 40) skippedSamples.push(src);
    return line;
  }

  const conv = convertMeasure(amount, name);
  if (!conv) {
    stats.skipped++;
    if (skippedSamples.length < 40) skippedSamples.push(src);
    return line;
  }

  name = name.replace(/[，,、\s]+$/, '').trim();
  if (!name) {
    stats.skipped++;
    if (skippedSamples.length < 40) skippedSamples.push(src);
    return line;
  }

  if (conv.metric) {
    if (isSameUnitText(amount, conv.out)) stats.keptChinese++;
    else stats.converted++;
    if (conv.noOriginal) stats.textMeasure++;
  } else {
    stats.keptChinese++;
  }

  let tailTxt = conv.tail || '';
  if (tailTxt && amount.toLowerCase().indexOf(tailTxt.toLowerCase()) !== -1) tailTxt = '';  // 已在原文里就不重复
  let out = name + '（' + conv.out;
  if (!conv.noOriginal && !isSameUnitText(amount, conv.out)) out += '；原 ' + amount;
  if (tailTxt) out += '；' + tailTxt;
  out += '）';

  if (out !== src && changed.length < 30) changed.push(src + '   =>   ' + out);
  return out;
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.drinks)) throw new Error('index.zh.json 缺少 drinks 数组');

  let lines = 0;
  for (const d of parsed.drinks) {
    if (!Array.isArray(d.ingredients_zh)) continue;
    d.ingredients_zh = d.ingredients_zh.map((x) => { lines++; return normalizeLine(x); });
    // 顺带把「做法」里仅有的几处「适量」改成自然的中文说法
    if (typeof d.instructions_zh === 'string') {
      INSTRUCTION_FIXES.forEach(([from, to]) => {
        if (d.instructions_zh.indexOf(from) !== -1) d.instructions_zh = d.instructions_zh.split(from).join(to);
      });
    }
  }

  console.log('配方 ' + parsed.drinks.length + ' 条 / 配料 ' + lines + ' 行');
  console.log('  换算成公制        : ' + stats.converted);
  console.log('  已是中文（未换算）: ' + stats.keptChinese);
  console.log('  文字型用量        : ' + stats.textMeasure);
  console.log('  补「根据个人口味」: ' + stats.addedShiliang);
  console.log('  已是规范格式(跳过): ' + stats.already);
  console.log('  保持原样(跳过)    : ' + stats.skipped);
  console.log('\n--- 改动示例 ---');
  changed.forEach((c) => console.log('  ' + c));
  if (skippedSamples.length) {
    console.log('\n--- 跳过示例 ---');
    skippedSamples.forEach((c) => console.log('  ' + c));
  }

  if (DRY) { console.log('\n[dry] 未写入文件'); return; }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  parsed.generated = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  fs.writeFileSync(SRC, JSON.stringify(parsed), 'utf8');
  console.log('\n已写回 ' + path.relative(ROOT, SRC));
}

main();
