'use strict';

/* 数据清理（幂等）：
   ① 跨源同名去重：od- 与 tcdb- 有 90 组完全同名的配方（同一款酒的两种写法），
      保留 tcdb-（分类、杯型更规范），删除 od- 的重复条目。
   ② 酒精字段推断：od- 有 446 条没有 alcoholic 字段，UI 会一律显示成「含酒精」，
      这里按配料关键词推断为 Alcoholic / Non alcoholic。
   直接改写 素材/index.zh.json；改完必须重跑 tools/gen-data.js。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '素材', 'index.zh.json');

/* 含酒精关键词（英文按单词边界匹配，避免 gin⊂ginger、rum⊂rumchata 之类误判） */
const ALCOHOL_EN = [
  'vodka', 'gin', 'rum', 'rumchata', 'whisky', 'whiskey', 'tequila', 'mezcal',
  'brandy', 'cognac', 'armagnac', 'calvados', 'grappa', 'pisco', 'cachaca', 'cachaça',
  'sake', 'soju', 'shochu', 'mirin', 'baijiu', 'awamori', 'umeshu', 'makgeolli',
  'wine', 'sherry', 'port', 'madeira', 'marsala', 'moscato', 'sangria', 'vermouth',
  'beer', 'ale', 'lager', 'stout', 'porter', 'cider', 'mead',
  'champagne', 'prosecco', 'cava', 'cremant', 'sparkling wine',
  'liqueur', 'schnapps', 'kahlua', 'kahlúa', 'amaretto', 'cointreau', 'curacao', 'curaçao',
  'triple sec', 'midori', 'chambord', 'drambuie', 'frangelico', 'galliano', 'sambuca',
  'chartreuse', 'benedictine', 'luxardo', 'maraschino', 'advocaat', 'baileys', 'irish cream',
  'jagermeister', 'jägermeister', 'jager', 'fireball', 'malibu', 'ricard', 'pastis', 'pernod',
  'absinthe', 'ouzo', 'raki', 'arak', 'araq', 'aquavit', 'akvavit', 'batida',
  'bitters', 'angostura', 'campari', 'aperol', 'fernet', 'amer',
  'bourbon', 'scotch', 'rye whisky', 'rye whiskey', 'moonshine', 'sloe gin',
  'bacardi', 'smirnoff', 'absolut', 'jameson', 'jack daniel', 'johnnie walker', 'seagrams',
  'martini', 'southern comfort', 'peach schnapps', 'applejack', 'everclear', 'grain alcohol',
  'rye', 'feni', 'aguardiente', 'pulque', 'kirsch', 'absinth', 'schnaps', 'liquor',
  'creme de', 'crème de', 'grand marnier', 'tia maria', 'disaronno', 'peychaud', 'pimm',
  'jim beam', 'crown royal', 'canadian club', 'wild turkey', 'hennessy', 'patron',
  'tanqueray', 'bombay sapphire', 'grey goose', 'havana club', 'captain morgan',
  'chivas', 'glenfiddich', 'macallan', 'lagavulin', 'bulleit', 'makers mark', 'woodford',
  'jose cuervo', 'cazadores', 'beefeater', 'gordon', 'dewars', 'talisker'
];

/* 名称里出现这些字样 → 直接判定无酒精（名称比配料更权威） */
const NON_ALCOHOL_NAME_RE = /virgin|mocktail|无酒精|non[-\s]?alcoholic|alcohol[-\s]?free/i;

/* 中文关键词（直接子串匹配） */
const ALCOHOL_ZH = [
  '伏特加', '金酒', '杜松子酒', '朗姆', '威士忌', '龙舌兰', '白兰地', '干邑',
  '清酒', '烧酒', '白酒', '黄酒', '米酒', '梅酒', '葡萄酒', '红酒', '白葡萄酒',
  '啤酒', '香槟', '味美思', '苦精', '利口酒', '金巴利', '阿佩罗', '苦艾酒',
  '卡莎萨', '梅斯卡尔', '君度', '蓝橙', '甘露酒', '百利甜', '野格', '料酒',
  '青稞酒', '高粱酒', '二锅头', '茅台', '朗姆酒', '白朗姆', '黑朗姆', '陈年朗姆'
];

/* 反向排除：出现这些说明该项本身是「无酒精替代品」或同名软饮 */
const NON_ALCOHOL_WORDS = [
  'non-alcoholic', 'non alcoholic', 'nonalcoholic', 'alcohol-free', 'alcohol free',
  'virgin', 'mocktail', '无酒精', '0.0%',
  'ginger ale', 'ginger beer', 'root beer', 'birch beer', 'bitter lemon', 'bitter orange'
];

const EN_RE = new RegExp('\\b(?:' + ALCOHOL_EN.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');

function isAlcoholicText(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  for (const w of NON_ALCOHOL_WORDS) if (s.indexOf(w) !== -1) return false;
  if (EN_RE.test(s)) return true;
  for (const w of ALCOHOL_ZH) if (s.indexOf(w) !== -1) return true;
  return false;
}

/* 一条配方：名称里若无酒精字样，则只要任一配料含酒精 → 含酒精 */
function inferAlcoholic(drink) {
  const names = [drink.name, drink.name_zh, drink.name_display].join(' ');
  if (NON_ALCOHOL_NAME_RE.test(names)) return 'Non alcoholic';
  const items = [].concat(drink.ingredients_en || [], drink.ingredients_zh || []);
  for (const it of items) if (isAlcoholicText(it)) return 'Alcoholic';
  return 'Non alcoholic';
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  const drinks = data.drinks;
  if (!Array.isArray(drinks)) throw new Error('index.zh.json 缺少 drinks 数组');

  /* ① 跨源同名去重 */
  const tcdbNames = new Set(drinks.filter(d => /^tcdb-/.test(String(d.id))).map(d => d.name_display));
  const before = drinks.length;
  data.drinks = drinks.filter(d => !(/^od-/.test(String(d.id)) && tcdbNames.has(d.name_display)));
  const removed = before - data.drinks.length;

  /* ② 酒精字段推断 */
  let inferred = 0;
  const samples = [];
  data.drinks.forEach(d => {
    if (d.alcoholic) return;
    d.alcoholic = inferAlcoholic(d);
    inferred++;
    if (samples.length < 8) samples.push(d.id + ' -> ' + d.alcoholic);
  });

  /* 同步顶层统计字段，保持素材文件自洽 */
  data.total = data.drinks.length;
  data.with_image = data.drinks.filter(d => d.image).length;

  fs.writeFileSync(SRC, JSON.stringify(data), 'utf8');

  const rest = data.drinks.length;
  const dist = data.drinks.reduce((m, d) => { m[d.alcoholic] = (m[d.alcoholic] || 0) + 1; return m; }, {});
  console.log('去重删除: ' + removed + ' 条（' + before + ' -> ' + rest + '）');
  console.log('推断酒精: ' + inferred + ' 条');
  console.log('酒精分布: ' + JSON.stringify(dist));
  console.log('样本: ' + samples.join(' | '));
  const stillEmpty = data.drinks.filter(d => !d.alcoholic).length;
  console.log('仍为空: ' + stillEmpty);
}

main();
