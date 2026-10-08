'use strict';

/* 「饮料兑酒」配方：中国常见瓶装饮料 × 各种基酒。
   幂等合并进 素材/index.zh.json（按 id 去重，重复执行不会重复插入）。
   用法：node tools/seed-mixer.js
   注意：配料用量写成已规范化的公制中文格式（与 tools/normalize-units.js 的产出一致），
        所以再跑 normalize-units 时会被识别为「已是规范格式」而跳过。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '素材', 'index.zh.json');
const CATEGORY = '饮料兑酒';
const GLASS = '高球杯';

function slug(name) {
  return String(name || 'drink').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drink';
}

function r(n, zh, en, alc, ings, steps) {
  const id = 'cn-' + String(n).padStart(3, '0');
  return {
    id: id,
    name: en,
    name_zh: zh,
    name_display: zh + '（' + en + '）',
    category: CATEGORY,
    alcoholic: alc,
    glass: GLASS,
    ingredients_en: [],
    ingredients_zh: ings,
    instructions_en: '',
    instructions_zh: steps,
    // 配图由 tools/fetch-mixer-images.js 抓到 素材/cn/ 下，命名规则见该脚本
    image: 'cn/' + id + '-' + slug(en) + '.jpg'
  };
}

const A = 'Alcoholic';
const N = 'Non alcoholic';

const RECIPES = [
  r(1, '雪碧伏特加', 'Sprite Vodka', A,
    ['伏特加（45 毫升）', '雪碧（加至满杯）', '青柠（1 片）'],
    '高球杯装满冰块，倒入伏特加，加雪碧至满杯，轻轻搅两下，放一片青柠。'),
  r(2, '自由古巴', 'Cuba Libre', A,
    ['白朗姆酒（45 毫升）', '可乐（加至满杯）', '青柠汁（10 毫升）'],
    '杯里挤入青柠汁，加满冰块，倒入白朗姆酒，加可乐至满杯，搅匀。'),
  r(3, '冰红茶威士忌', 'Whiskey Iced Tea', A,
    ['威士忌（45 毫升）', '冰红茶（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入威士忌和冰红茶，搅匀后放一片柠檬。'),
  r(4, '王老吉威士忌', 'Wong Lo Kat Highball', A,
    ['威士忌（40 毫升）', '王老吉（加至满杯）', '冰块（根据个人口味）'],
    '高球杯加满冰块，倒入威士忌，沿杯壁加王老吉至满杯，轻搅一次。'),
  r(5, '椰汁朗姆', 'Coconut Rum Cooler', A,
    ['白朗姆酒（45 毫升）', '椰汁（120 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入白朗姆酒与椰汁，搅匀即可。'),
  r(6, '养乐多伏特加', 'Yakult Vodka', A,
    ['伏特加（30 毫升）', '养乐多（100 毫升）', '苏打水（60 毫升）'],
    '杯中加冰，先倒养乐多和伏特加，再沿杯壁加苏打水，轻搅。'),
  r(7, '酸梅汤金酒', 'Sour Plum Gin Fizz', A,
    ['金酒（40 毫升）', '酸梅汤（120 毫升）', '气泡水（60 毫升）'],
    '杯中加冰，倒入金酒与酸梅汤，最后加气泡水，搅匀。'),
  r(8, '白桃气泡伏特加', 'Peach Sparkling Vodka', A,
    ['伏特加（45 毫升）', '白桃气泡水（加至满杯）', '柠檬（1 片）'],
    '高球杯加冰，倒入伏特加，加白桃气泡水至满杯，放柠檬片。'),
  r(9, '茉莉绿茶金酒', 'Jasmine Gin Tea', A,
    ['金酒（40 毫升）', '茉莉绿茶（120 毫升）', '蜂蜜（5 毫升）'],
    '杯中加冰，倒入金酒、茉莉绿茶与蜂蜜，搅拌至蜂蜜化开。'),
  r(10, '美年达龙舌兰', 'Fanta Tequila', A,
    ['龙舌兰（45 毫升）', '美年达（加至满杯）', '青柠（1 块）'],
    '高球杯加冰，倒入龙舌兰，加美年达至满杯，放一块青柠。'),
  r(11, '干姜水黑朗姆', 'Dark Ginger Highball', A,
    ['黑朗姆酒（45 毫升）', '干姜水（加至满杯）', '青柠汁（10 毫升）'],
    '杯中加冰，倒入黑朗姆酒和青柠汁，加干姜水至满杯。'),
  r(12, '金汤力', 'Gin and Tonic', A,
    ['金酒（45 毫升）', '汤力水（加至满杯）', '青柠（1 块）'],
    '高球杯加满冰块，倒入金酒，加汤力水至满杯，挤入青柠块。'),
  r(13, '冰红茶伏特加', 'Vodka Iced Tea', A,
    ['伏特加（45 毫升）', '冰红茶（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入伏特加与冰红茶，搅匀后放柠檬片。'),
  r(14, '可乐威士忌', 'Whiskey Cola', A,
    ['威士忌（45 毫升）', '可乐（加至满杯）', '冰块（根据个人口味）'],
    '杯中加满冰块，倒入威士忌，加可乐至满杯，搅一下。'),
  r(15, '雪碧金酒', 'Gin Sprite', A,
    ['金酒（40 毫升）', '雪碧（加至满杯）', '青柠（1 片）'],
    '高球杯加冰，倒入金酒，加雪碧至满杯，放青柠片。'),
  r(16, '椰汁伏特加', 'Vodka Coconut', A,
    ['伏特加（45 毫升）', '椰汁（120 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入伏特加与椰汁，搅匀。'),
  r(17, '酸梅汤伏特加', 'Vodka Sour Plum', A,
    ['伏特加（45 毫升）', '酸梅汤（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入伏特加和酸梅汤，搅匀后放柠檬片。'),
  r(18, '王老吉朗姆', 'Rum Herbal Cooler', A,
    ['白朗姆酒（45 毫升）', '王老吉（加至满杯）', '青柠汁（10 毫升）'],
    '杯中加冰，倒入白朗姆酒与青柠汁，加王老吉至满杯。'),
  r(19, '养乐多金酒', 'Gin Yakult', A,
    ['金酒（30 毫升）', '养乐多（100 毫升）', '苏打水（60 毫升）'],
    '杯中加冰，倒入养乐多与金酒，再加苏打水，轻搅。'),
  r(20, 'AD钙奶伏特加', 'Vodka AD Calcium Milk', A,
    ['伏特加（30 毫升）', 'AD钙奶（150 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入伏特加与 AD 钙奶，搅匀。'),
  r(21, '豆奶威士忌', 'Whiskey Soy Milk', A,
    ['威士忌（45 毫升）', '豆奶（120 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入威士忌与豆奶，搅匀。'),
  r(22, '冰红茶白兰地', 'Brandy Iced Tea', A,
    ['白兰地（40 毫升）', '冰红茶（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入白兰地与冰红茶，搅匀后放柠檬片。'),
  r(23, '绿茶清酒', 'Sake Green Tea', A,
    ['清酒（60 毫升）', '绿茶（90 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，先倒清酒再倒绿茶，轻搅。'),
  r(24, '可乐清酒', 'Sake Cola', A,
    ['清酒（60 毫升）', '可乐（90 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入清酒，加可乐，搅匀后放柠檬片。'),
  r(25, '雪碧清酒', 'Sake Sprite', A,
    ['清酒（60 毫升）', '雪碧（90 毫升）', '青柠（1 片）'],
    '杯中加冰，倒入清酒与雪碧，搅匀后放青柠片。'),
  r(26, '奶茶威士忌', 'Whiskey Milk Tea', A,
    ['威士忌（40 毫升）', '奶茶（120 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入威士忌与奶茶，搅匀。'),
  r(27, '椰汁金酒', 'Gin Coconut', A,
    ['金酒（45 毫升）', '椰汁（120 毫升）', '青柠汁（10 毫升）'],
    '杯中加冰，倒入金酒、椰汁与青柠汁，搅匀。'),
  r(28, '美年达伏特加', 'Vodka Fanta', A,
    ['伏特加（45 毫升）', '美年达（加至满杯）', '橙子（1 片）'],
    '高球杯加冰，倒入伏特加，加美年达至满杯，放橙片。'),
  r(29, '柠檬茶威士忌', 'Whiskey Lemon Tea', A,
    ['威士忌（45 毫升）', '柠檬茶（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入威士忌与柠檬茶，搅匀后放柠檬片。'),
  r(30, '朗姆苏打', 'Rum Soda', A,
    ['白朗姆酒（45 毫升）', '苏打水（加至满杯）', '青柠（1 块）'],
    '高球杯加满冰，倒入白朗姆酒，加苏打水至满杯，挤入青柠。'),
  r(31, '威士忌干姜', 'Whiskey Ginger', A,
    ['威士忌（45 毫升）', '姜汁汽水（加至满杯）', '青柠（1 块）'],
    '高球杯加冰，倒入威士忌，加姜汁汽水至满杯，放青柠块。'),
  r(32, '王老吉伏特加', 'Vodka Herbal Cooler', A,
    ['伏特加（45 毫升）', '王老吉（加至满杯）', '冰块（根据个人口味）'],
    '杯中加满冰块，倒入伏特加，加王老吉至满杯，轻搅。'),
  r(33, '养乐多朗姆', 'Rum Yakult', A,
    ['白朗姆酒（30 毫升）', '养乐多（100 毫升）', '苏打水（60 毫升）'],
    '杯中加冰，倒入养乐多与白朗姆酒，再加苏打水，轻搅。'),
  r(34, '酸梅汤威士忌', 'Whiskey Sour Plum', A,
    ['威士忌（45 毫升）', '酸梅汤（120 毫升）', '冰块（根据个人口味）'],
    '杯中加冰，倒入威士忌与酸梅汤，搅匀。'),
  r(35, '二锅头冰红茶', 'Erguotou Iced Tea', A,
    ['白酒（40 毫升）', '冰红茶（120 毫升）', '柠檬（1 片）'],
    '杯中加冰，倒入白酒与冰红茶，搅匀后放柠檬片。'),
  r(36, '米酒雪碧', 'Mijiu Sprite', A,
    ['米酒（60 毫升）', '雪碧（90 毫升）', '青柠（1 片）'],
    '杯中加冰，倒入米酒与雪碧，搅匀后放青柠片。')
];

function main() {
  const raw = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.drinks)) throw new Error('index.zh.json 缺少 drinks 数组');

  const ids = {};
  RECIPES.forEach(function (d) { ids[d.id] = d; });
  // 幂等：先移除同 id 的旧记录，再追加
  const kept = parsed.drinks.filter(function (d) { return !ids[d.id]; });
  const dupNames = {};
  kept.forEach(function (d) { dupNames[d.name_display] = 1; });
  const toAdd = RECIPES.filter(function (d) {
    if (dupNames[d.name_display]) throw new Error('酒名重复：' + d.name_display);
    return true;
  });

  parsed.drinks = kept.concat(toAdd);
  parsed.total = parsed.drinks.length;
  parsed.with_image = parsed.drinks.filter(function (d) { return !!d.image; }).length;
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  parsed.generated = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());

  fs.writeFileSync(SRC, JSON.stringify(parsed), 'utf8');
  console.log('兑酒配方 ' + RECIPES.length + ' 条已合并');
  console.log('总数 ' + parsed.total + ' / 带图 ' + parsed.with_image);
}

main();
