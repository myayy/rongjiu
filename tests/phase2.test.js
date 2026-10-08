'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const Tags = require(path.join(ROOT, 'js', 'tags.js'));

const DRINKS = globalThis.DRINKS;

test('tags.js 导出完整 API', () => {
  for (const k of ['deriveTastes', 'estimatePrice', 'defaultTiers', 'normalizeTiers', 'tierOf', 'ALL_TASTE_TAGS']) {
    assert.ok(Tags[k] !== undefined, `缺少 ${k}`);
  }
});

test('全部 1395 条都能推导口感标签', () => {
  for (const d of DRINKS) {
    const t = Tags.deriveTastes(d);
    assert.ok(Array.isArray(t) && t.length > 0, `${d.id} 无口感标签`);
    for (const tag of t) assert.ok(Tags.ALL_TASTE_TAGS.includes(tag), `${d.id} 非法标签 ${tag}`);
  }
});

test('全部 1395 条都能估算价格，且为 5~300 元整数', () => {
  for (const d of DRINKS) {
    const p = Tags.estimatePrice(d);
    assert.ok(Number.isInteger(p), `${d.id} 价格非整数`);
    assert.ok(p >= 5 && p <= 300, `${d.id} 价格越界: ${p}`);
  }
});

test('已知配方的口感与价格方向正确', () => {
  const mojito = DRINKS.find((d) => d.name === 'Mojito');
  const t = Tags.deriveTastes(mojito);
  assert.ok(t.includes('清爽') || t.includes('酸'), '莫吉托应偏清爽/酸: ' + t);

  const margarita = DRINKS.find((d) => d.name === 'Margarita');
  assert.ok(Tags.deriveTastes(margarita).includes('酸'), '玛格丽特应含酸味');

  // 含奶油的配方必须能打上浓郁
  const creamy = DRINKS.find((d) => Tags.deriveTastes(d).includes('浓郁'));
  assert.ok(creamy, '至少应有配方命中浓郁');
  // 含气泡类配料的配方必须能打上清爽
  const fizz = DRINKS.find((d) => Tags.deriveTastes(d).includes('清爽'));
  assert.ok(fizz, '至少应有配方命中清爽');
});

test('价格：果汁类低于香槟类', () => {
  const juice = DRINKS.find((d) => d.name === 'Afterglow');
  const bubbly = DRINKS.find((d) => d.name.includes('Champagne'));
  assert.ok(juice && bubbly, '测试样本存在');
  assert.ok(Tags.estimatePrice(juice) < Tags.estimatePrice(bubbly),
    `${juice.name}=${Tags.estimatePrice(juice)} 应 < ${bubbly.name}=${Tags.estimatePrice(bubbly)}`);
});

test('默认档位覆盖 0~∞ 且无重叠', () => {
  const tiers = Tags.defaultTiers();
  assert.equal(tiers.length, 3);
  assert.equal(tiers[0].min, 0);
  assert.equal(tiers[tiers.length - 1].max, Infinity);
  for (let p = 0; p <= 500; p += 7) {
    const hit = tiers.filter((t) => Tags.priceInTier(p, t));
    assert.equal(hit.length, 1, `价格 ${p} 命中 ${hit.length} 个档位`);
  }
});

test('用户自定义档位覆盖默认档位', () => {
  const custom = [
    { label: '便宜', min: 0, max: 20 },
    { label: '小贵', min: 20, max: 50 },
    { label: '奢侈', min: 50, max: 99999 }
  ];
  const tiers = Tags.normalizeTiers(custom);
  assert.equal(tiers.length, 3);
  assert.equal(tiers[0].label, '便宜');
  assert.equal(Tags.tierOf(15, tiers).label, '便宜');
  assert.equal(Tags.tierOf(35, tiers).label, '小贵');
  assert.equal(Tags.tierOf(60, tiers).label, '奢侈');
  assert.equal(Tags.tierOf(999999, tiers), null, '超出所有档位返回 null');
});

test('非法/空自定义档位回退默认', () => {
  assert.deepEqual(Tags.normalizeTiers(null), Tags.defaultTiers());
  assert.deepEqual(Tags.normalizeTiers('x'), Tags.defaultTiers());
  assert.deepEqual(Tags.normalizeTiers([{ label: '' }, null]), Tags.defaultTiers());
  assert.equal(Tags.normalizeTiers([{ label: 'A', min: 'abc', max: 'zzz' }])[0].min, 0);
});

test('盲盒按自定义档位筛选能缩小结果集', () => {
  const tiers = Tags.normalizeTiers([
    { label: '便宜', min: 0, max: 25 },
    { label: '中等', min: 25, max: 60 },
    { label: '贵', min: 60, max: 99999 }
  ]);
  const cheap = DRINKS.filter((d) => Tags.tierOf(Tags.estimatePrice(d), tiers) && Tags.tierOf(Tags.estimatePrice(d), tiers).id === 't0');
  assert.ok(cheap.length > 50, `便宜档应有较多配方，实际 ${cheap.length}`);
  assert.ok(cheap.length < DRINKS.length, '便宜档不应包含全部配方');
  for (const d of cheap) assert.ok(Tags.estimatePrice(d) < 25);
});
