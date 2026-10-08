'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const Tags = require(path.join(ROOT, 'js', 'tags.js'));
const Core = require(path.join(ROOT, 'js', 'core.js'));

const DRINKS = globalThis.DRINKS;

test('路由：空 hash 默认推荐页', () => {
  const r = Core.parseHash('');
  assert.equal(r.page, 'recommend');
  assert.equal(r.id, null);
  assert.deepEqual(r.q, {});
  assert.deepEqual(Core.parseHash('#'), Core.parseHash(''));
  assert.deepEqual(Core.parseHash('#/nonsense'), Core.parseHash(''));
});

test('路由：三个 Tab + 浏览历史页与详情页', () => {
  for (const p of ['recommend', 'cabinet', 'box', 'history']) {
    assert.equal(Core.parseHash('#/' + p).page, p);
  }
  assert.equal(Core.buildHash({ page: 'history', q: {} }), '#/history');
  assert.equal(Core.parseHash('#/recommend?sec=vodka').q.sec, 'vodka', '分区参数应能解析');
  const d = Core.parseHash('#/drink/tcdb-11000');
  assert.equal(d.page, 'drink');
  assert.equal(d.id, 'tcdb-11000');
});

test('路由：query 解析与还原往返一致', () => {
  const hash = '#/recommend?q=' + encodeURIComponent('莫吉托') + '&alcoholic=yes&category=' + encodeURIComponent('Cocktail');
  const r = Core.parseHash(hash);
  assert.equal(r.page, 'recommend');
  assert.equal(r.q.q, '莫吉托');
  assert.equal(r.q.alcoholic, 'yes');
  assert.equal(r.q.category, 'Cocktail');
  assert.equal(Core.buildHash(r), hash);
  assert.equal(Core.buildHash({ page: 'cabinet', q: {} }), '#/cabinet');
  assert.equal(Core.buildHash({ page: 'drink', id: 'od-zombie', q: {} }), '#/drink/od-zombie');
  // 空值参数不进 hash
  assert.equal(Core.buildHash({ page: 'recommend', q: { q: '', x: '1' } }), '#/recommend?x=1');
});

test('搜索：中文名/英文名/配料均可命中，且支持逐字匹配', () => {
  assert.ok(Core.filterRecipes(DRINKS, { q: '莫吉托' }).length >= 1);
  const en = Core.filterRecipes(DRINKS, { q: 'mojito' });
  assert.ok(en.length >= 1);
  assert.ok(en.some((d) => d.name === 'Mojito'));
  assert.ok(Core.filterRecipes(DRINKS, { q: '伏特加' }).length > 50);
  assert.equal(Core.filterRecipes(DRINKS, { q: 'qzxqzx' }).length, 0);

  // 逐字匹配：字不必连续，命中任一字即可
  const loose = Core.filterRecipes(DRINKS, { q: '莫托' });
  assert.ok(loose.some((d) => d.name_zh.includes('莫吉托')), '「莫托」应能找到「莫吉托」');
  // 单字也能筛，且字越多命中越多（OR 语义）
  assert.ok(Core.filterRecipes(DRINKS, { q: '莫' }).length > 0, '单字应能筛出结果');
  assert.ok(Core.filterRecipes(DRINKS, { q: '莫' }).length < Core.filterRecipes(DRINKS, { q: '莫吉托' }).length);

  // 空搜索返回全部
  assert.equal(Core.filterRecipes(DRINKS, {}).length, DRINKS.length);
  assert.equal(Core.filterRecipes(DRINKS, { q: '   ' }).length, DRINKS.length);
});

test('queryTokens：中文逐字、ASCII 整段、忽略空白与大小写', () => {
  assert.deepEqual(Core.queryTokens('莫 托'), ['莫', '托']);
  assert.deepEqual(Core.queryTokens('莫吉托'), ['莫', '吉', '托']);
  assert.deepEqual(Core.queryTokens('mojito'), ['mojito'], 'ASCII 不逐字拆');
  assert.deepEqual(Core.queryTokens('MOJITO'), ['mojito']);
  assert.deepEqual(Core.queryTokens('莫 mojito'), ['莫', 'mojito']);
  assert.deepEqual(Core.queryTokens('莫莫莫'), ['莫'], '重复 token 去重');
  assert.deepEqual(Core.queryTokens('   '), []);
  assert.deepEqual(Core.queryTokens(''), []);
});

test('筛选：含酒精 / 分类', () => {
  const yes = Core.filterRecipes(DRINKS, { alcoholic: 'yes' });
  assert.ok(yes.every((d) => d.alcoholic === 'Alcoholic'));
  assert.ok(yes.length > 500);
  const no = Core.filterRecipes(DRINKS, { alcoholic: 'no' });
  assert.ok(no.length > 50);
  assert.ok(no.every((d) => d.alcoholic === 'Non alcoholic'));

  const cats = Core.uniqueCategories(DRINKS);
  assert.ok(cats.length >= 10);
  const c = Core.filterRecipes(DRINKS, { category: cats[0] });
  assert.ok(c.length > 0);
  assert.ok(c.every((d) => d.category === cats[0]));
});

test('筛选：组合条件是交集', () => {
  const a = Core.filterRecipes(DRINKS, { q: 'mojito' });
  const b = Core.filterRecipes(DRINKS, { q: 'mojito', alcoholic: 'yes' });
  assert.ok(b.length <= a.length);
  assert.ok(b.every((d) => d.name.toLowerCase().includes('mojito') || d.name_zh.includes('莫吉托')));
  assert.ok(b.every((d) => d.alcoholic === 'Alcoholic'));
});

test('盲盒：档位 + 口感筛选池非空且命中条件', () => {
  const tiers = Tags.normalizeTiers([
    { label: '便宜', min: 0, max: 30 },
    { label: '中等', min: 30, max: 80 },
    { label: '贵', min: 80, max: 99999 }
  ]);
  const pool = Core.buildBlindPool(DRINKS, {
    tierIds: [tiers[0].id],
    tastes: ['甜'],
    customTiers: tiers
  }, Tags);
  assert.ok(pool.length > 10, `池应非空，实际 ${pool.length}`);
  for (const d of pool) {
    const tier = Tags.tierOf(Tags.estimatePrice(d), tiers);
    assert.equal(tier.id, tiers[0].id, `${d.id} 档位不符`);
    assert.ok(Tags.deriveTastes(d).includes('甜'), `${d.id} 口感不符`);
  }
});

test('盲盒：条件全部满足时池为空有明确结果（不抛异常）', () => {
  const pool = Core.buildBlindPool(DRINKS, { q: 'qzxqzx', tastes: ['甜'] }, Tags);
  assert.equal(pool.length, 0);
  assert.equal(Core.pickRandom(pool), null);
});

test('盲盒：pickRandom 支持排除上次结果', () => {
  const pool = DRINKS.slice(0, 5);
  const first = Core.pickRandom(pool);
  assert.ok(pool.includes(first));
  const second = Core.pickRandom(pool, { exclude: [first.id] });
  assert.notEqual(second.id, first.id);
  // 全部被排除时回退到全池，不返回 null
  const all = Core.pickRandom(pool, { exclude: pool.map((d) => d.id) });
  assert.ok(pool.includes(all));
  assert.equal(Core.pickRandom([]), null);
});

test('洗牌：同种子顺序固定，不同种子顺序不同，元素不丢不改', () => {
  const origIds = DRINKS.map((d) => d.id);
  const a = Core.shuffle(DRINKS, 12345);
  const b = Core.shuffle(DRINKS, 12345);
  assert.deepEqual(a.map((d) => d.id), b.map((d) => d.id), '同种子应完全一致');

  const c = Core.shuffle(DRINKS, 54321);
  assert.notDeepEqual(c.map((d) => d.id), a.map((d) => d.id), '不同种子应换顺序');

  assert.equal(a.length, DRINKS.length, '长度不变');
  assert.deepEqual(a.map((d) => d.id).sort(), origIds.slice().sort(), '元素不丢不重');
  assert.notDeepEqual(a.map((d) => d.id), origIds, '顺序确实被打散');
  assert.deepEqual(DRINKS.map((d) => d.id), origIds, '原数组不被就地改动');

  assert.equal(Core.shuffle([], 1).length, 0);
  assert.equal(Core.shuffle(null, 1).length, 0);
});

test('id 可通过 buildHash 定位到详情页', () => {
  const d = DRINKS[700];
  const r = Core.parseHash(Core.buildHash({ page: 'drink', id: d.id }));
  assert.equal(r.page, 'drink');
  assert.equal(r.id, d.id);
});
