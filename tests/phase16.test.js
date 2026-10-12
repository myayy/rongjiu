'use strict';

/* P16：界面改版配套功能
   盲盒去重记忆持久化（rj.blindSeen 生效）/ 详情配料「已有」标记 / pantryFlags */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeEnv, click } = require('./fakedom');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const Tags = require(path.join(ROOT, 'js', 'tags.js'));
const Core = require(path.join(ROOT, 'js', 'core.js'));
const UI = require(path.join(ROOT, 'js', 'ui.js'));
const RJStore = require(path.join(ROOT, 'js', 'store.js'));
const RJApp = require(path.join(ROOT, 'js', 'app.js'));

const DRINKS = globalThis.DRINKS;

function makeApp(opts) {
  opts = opts || {};
  const env = makeEnv();
  const store = RJStore.createStore(opts.storage || RJStore.memoryStorage());
  const app = RJApp.createApp({
    doc: env.doc, win: env.win, store, core: Core, ui: UI, tags: Tags,
    seed: opts.seed, random: opts.random, now: opts.now
  });
  app._env = env;
  app._store = store;
  app.start();
  return app;
}

function go(app, hash) {
  app._env.win.location.hash = hash;
  app.onHashChange();
}

function viewHtml(app) {
  return app._env.doc.getElementById('view').innerHTML;
}

/* ---- pantryFlags：详情配料逐条打标 ---- */
test('pantryFlags 返回与配料等长的布尔数组，已有为 true', () => {
  const drink = { ingredients_zh: ['60 毫升朗姆酒', '15 毫升柠檬汁', '冰块'] };
  const flags = Tags.pantryFlags(drink, ['朗姆酒']);
  assert.equal(flags.length, 3);
  assert.equal(flags[0], true, '朗姆酒应命中');
  assert.equal(flags[1], false, '柠檬汁未填不该标');
  assert.equal(flags[2], false, '冰块不算（ING_STOP）');
});

test('pantryFlags 单向包含：配方「白朗姆酒」能被填的「朗姆酒」命中', () => {
  const flags = Tags.pantryFlags({ ingredients_zh: ['30 毫升白朗姆酒'] }, ['朗姆酒']);
  assert.equal(flags[0], true);
});

test('pantryFlags 空材料 / 无配料不报错', () => {
  assert.deepEqual(Tags.pantryFlags({ ingredients_zh: ['60 毫升金酒'] }, []), [false]);
  assert.deepEqual(Tags.pantryFlags({ ingredients_zh: [] }, ['金酒']), []);
});

/* ---- 详情页「已有」标记 ---- */
test('详情页配料行：家里已有的材料带「已有」标记', () => {
  const pick = DRINKS.find((d) => d.ingredients_zh && d.ingredients_zh.length >= 2);
  assert.ok(pick, '应有样本');
  const app = makeApp();
  app._store.addPantry(Tags.ingredientName(pick.ingredients_zh[0]));
  go(app, '#/drink/' + pick.id);
  const html = viewHtml(app);
  assert.ok(html.includes('ing-tag'), '应有「已有」标记');
  assert.ok(html.includes('已有'));
});

test('详情页没录材料时配料行不带标记', () => {
  const pick = DRINKS.find((d) => d.ingredients_zh && d.ingredients_zh.length >= 1);
  assert.ok(pick, '应有样本');
  const app = makeApp();
  go(app, '#/drink/' + pick.id);
  const html = viewHtml(app);
  assert.ok(!html.includes('ing-tag'), '不应出现「已有」标记');
});

/* ---- 盲盒去重记忆持久化 ---- */
test('盲盒去重记忆持久化：抽过的酒写进 rj.blindSeen，重启后仍排除', () => {
  const storage = RJStore.memoryStorage();   // 底层存储：两个 app 共享，模拟「重启数据还在」
  const realRandom = Math.random;
  Math.random = () => 0;   // 让 pickRandom 总选候选池第一个，结果确定
  try {
    const app1 = makeApp({ storage: storage });
    go(app1, '#/box');
    click(app1._env.doc, { 'data-act': 'blindDraw' });
    const seen1 = app1._store.getSeen();
    assert.ok(seen1.length >= 1, '抽一次应记入 seen');
    click(app1._env.doc, { 'data-act': 'blindAgain' });
    const seen2 = app1._store.getSeen();
    assert.ok(seen2.length >= 2, '再抽一次 seen 应累积');
    assert.notEqual(seen2[seen2.length - 1], seen2[seen2.length - 2], '两次不应抽到同一瓶');

    // 模拟重启：同一底层存储新建 app（内存 lastId 已丢），靠持久化的 seen 排除
    const app2 = makeApp({ storage: storage });
    go(app2, '#/box');
    click(app2._env.doc, { 'data-act': 'blindDraw' });
    const seen3 = app2._store.getSeen();
    const last3 = seen3[seen3.length - 1];
    assert.ok(!seen2.includes(last3), '重启后抽中的应是没抽过的新酒');
  } finally {
    Math.random = realRandom;
  }
});