'use strict';

/* P12：数据清洗（酒精推断 + 跨源去重）与中文化 / 交互修复的回归测试 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeEnv } = require('./fakedom');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const Tags = require(path.join(ROOT, 'js', 'tags.js'));
const Core = require(path.join(ROOT, 'js', 'core.js'));
const UI = require(path.join(ROOT, 'js', 'ui.js'));
const RJStore = require(path.join(ROOT, 'js', 'store.js'));
const RJApp = require(path.join(ROOT, 'js', 'app.js'));

function makeApp(opts) {
  opts = opts || {};
  const env = makeEnv();
  const store = RJStore.createStore(opts.storage || RJStore.memoryStorage());
  const app = RJApp.createApp({
    doc: env.doc, win: env.win, store, core: Core, ui: UI, tags: Tags,
    seed: opts.seed, now: opts.now
  });
  app._env = env;
  app._store = store;
  app.start();
  return app;
}

/* ---------- 数据：酒精字段 ---------- */

test('酒精字段全库无空值，取值只有三种', () => {
  const distinct = new Set();
  for (const d of globalThis.DRINKS) {
    assert.ok(d.alcoholic, `${d.id} 酒精字段为空`);
    distinct.add(d.alcoholic);
  }
  assert.deepEqual([...distinct].sort(), ['Alcoholic', 'Non alcoholic', 'Optional alcohol']);
});

test('按配料推断的酒精结果正确', () => {
  const byName = (n) => globalThis.DRINKS.find((d) => d.name_display.includes(n));
  assert.equal(byName('无酒精莫吉托').alcoholic, 'Non alcoholic', 'Virgin Mojito 应无酒精');
  assert.equal(byName('无酒精玛格丽特').alcoholic, 'Non alcoholic', '名称含无酒精应优先判无酒精');
  assert.equal(byName('阿多尼斯').alcoholic, 'Alcoholic', '含雪莉酒应判含酒精');
  assert.equal(byName('艾必西果汁').alcoholic, 'Non alcoholic', '纯果蔬汁应判无酒精');
  assert.equal(byName('莫斯科骡子').alcoholic, 'Alcoholic', '含伏特加应判含酒精');
  assert.equal(byName('乌拉克').alcoholic, 'Alcoholic', '含腰果酒 feni 应判含酒精');
});

test('软饮不被误判为含酒精（Ginger Ale / Root Beer）', () => {
  const soft = globalThis.DRINKS.filter((d) =>
    (d.ingredients_en || []).some((x) => /ginger ale/i.test(x)));
  assert.ok(soft.length > 0, '应存在含 Ginger Ale 的配方');
  for (const d of soft) {
    const hasSpirit = (d.ingredients_en || []).some((x) =>
      /vodka|gin|rum|whisky|whiskey|tequila|brandy/i.test(x));
    if (!hasSpirit) {
      assert.equal(d.alcoholic, 'Non alcoholic', `${d.name_display} 只有姜汁汽水不该判含酒精`);
    }
  }
});

/* ---------- 数据：跨源去重 ---------- */

test('跨源同名（od- 与 tcdb-）已去重', () => {
  const byName = {};
  for (const d of globalThis.DRINKS) {
    (byName[d.name_display] = byName[d.name_display] || []).push(d.id);
  }
  const dups = Object.entries(byName).filter(([, ids]) => ids.length > 1);
  assert.equal(dups.length, 0, '不应再有同名配方：' + JSON.stringify(dups.slice(0, 3)));
  assert.ok(globalThis.DRINKS.some((d) => d.id === 'tcdb-11000'), 'tcdb- 侧应保留');
  assert.ok(!globalThis.DRINKS.some((d) => d.id === 'od-mojito'), '同名的 od- 条目应已删除');
});

test('每条配方都能归入某一酒精档（筛选与标签不再矛盾）', () => {
  const all = globalThis.DRINKS;
  const sum = all.filter((d) => d.alcoholic === 'Alcoholic').length
    + all.filter((d) => d.alcoholic === 'Non alcoholic').length
    + all.filter((d) => d.alcoholic === 'Optional alcohol').length;
  assert.equal(sum, all.length);
  assert.ok(all.filter((d) => d.alcoholic === 'Non alcoholic').length > 200, '无酒精档应有足够数量');
});

/* ---------- 中文化 ---------- */

test('类目 / 杯型 / 酒精标签映射', () => {
  assert.equal(Tags.categoryLabel('Cocktail'), '鸡尾酒');
  assert.equal(Tags.categoryLabel('gin'), '金酒');
  assert.equal(Tags.categoryLabel(''), '');
  assert.equal(Tags.categoryLabel('没映射过的词'), '没映射过的词', '未命中应保留原文');
  assert.equal(Tags.glassLabel('Highball glass'), '高球杯');
  assert.equal(Tags.glassLabel('shot glass'), '子弹杯');
  assert.equal(Tags.glassLabel(''), '');
  assert.equal(Tags.alcoholLabel('Alcoholic'), '含酒精');
  assert.equal(Tags.alcoholLabel('Non alcoholic'), '无酒精');
  assert.equal(Tags.alcoholLabel('Optional alcohol'), '可选含酒精');
});

test('卡片口味摘要不再出现「甜等」', () => {
  const drink = {
    id: 'x1', name_display: '测试特调', category: 'Cocktail', alcoholic: 'Alcoholic',
    ingredients_zh: ['30毫升伏特加', '15毫升柠檬汁', '10毫升糖浆']
  };
  const html = UI.cardHtml(drink, {}, Tags);
  assert.ok(!html.includes('等</span>'), '不应出现「xx等」这种摘要');
  assert.ok(/chip">/.test(html));
});

test('详情页元信息全部中文', () => {
  const drink = {
    id: 'x2', name_display: '测试特调', category: 'Cocktail', alcoholic: 'Alcoholic',
    glass: 'Highball glass', ingredients_zh: ['30毫升伏特加'], instructions_zh: '摇匀。'
  };
  const html = UI.detailHtml(drink, {}, Tags);
  assert.ok(!html.includes('Alcoholic'), '不应出现英文 Alcoholic');
  assert.ok(!html.includes('Highball glass'), '不应出现英文杯型');
  assert.ok(html.includes('鸡尾酒'));
  assert.ok(html.includes('含酒精'));
  assert.ok(html.includes('高球杯'));
});

test('详情页杯型为空时不渲染空标签', () => {
  const drink = {
    id: 'x3', name_display: '无杯型', category: 'Cocktail', alcoholic: 'Non alcoholic',
    glass: '', ingredients_zh: ['30毫升果汁'], instructions_zh: '拌匀。'
  };
  const html = UI.detailHtml(drink, {}, Tags);
  assert.ok(html.includes('无酒精'));
  assert.ok(!/chip">\s*<\/span>/.test(html), '不应出现空 chip');
});

test('盲盒页有独立的「酒精」分组', () => {
  const html = UI.blindHtml({ tierIds: [], tastes: [], alcoholic: '', pool: [] }, Tags.defaultTiers(), Tags);
  assert.ok(html.includes('<h3>酒精</h3>'), '酒精应自成一组');
});

test('设置页清空文案说明了真实影响范围', () => {
  const html = UI.settingsHtml({ tierCount: 3 });
  assert.ok(html.includes('含酒柜 / 自制 / 材料 / 评分 / 历史'), '应提醒会清掉自制、材料与历史');
});

test('清空数据的确认弹层文案提到材料与历史', () => {
  const app = makeApp({ seed: 111 });
  app.handleAction('clearAll', null);
  assert.equal(app.state.overlay, 'confirm', '不再用原生 confirm，改弹应用内确认层');
  const html = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(html.includes('材料') && html.includes('历史'), '确认文案应说明真实影响范围：' + html);
  assert.ok(html.includes('data-act="confirmYes"') && html.includes('data-act="confirmNo"'), '要有确定与取消两个出口');
});

/* ---------- 交互 ---------- */

test('直接打开详情页 URL 也会记浏览历史', () => {
  const app = makeApp({ seed: 111, now: () => 1700000000000 });
  app._env.win.location.hash = '#/drink/cn-001';
  app.onHashChange();
  assert.deepEqual(app._store.getHistory(), [{ id: 'cn-001', at: 1700000000000 }]);
});

test('酒柜页「喝过的酒」不再重复显示「已喝过」', () => {
  const app = makeApp({ seed: 111 });
  app._store.setRating('cn-001', 4);
  app._env.win.location.hash = '#/cabinet';
  app.onHashChange();
  const html = app._env.doc.getElementById('view').innerHTML;
  const times = html.split('已喝过').length - 1;
  assert.ok(times === 1, `「已喝过」应只出现 1 次（星级那处），实际 ${times} 次`);
});

test('浏览历史页用靠右小按钮而非整行大按钮', () => {
  const app = makeApp({ seed: 111, now: () => 1700000000000 });
  app._env.win.location.hash = '#/drink/cn-001';
  app.onHashChange();
  app._env.win.location.hash = '#/history';
  app.onHashChange();
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('class="hist-head"'), '应使用 hist-head 容器');
  assert.ok(html.includes('class="hist-clear"'), '应使用 hist-clear 小按钮');
});
