'use strict';

/* P8：推荐页改版后的行为——加载更多 / 触底追加 / 换一批 / 返回恢复滚动 */

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

function makeApp(opts) {
  opts = opts || {};
  const env = makeEnv();
  const store = RJStore.createStore(opts.storage || RJStore.memoryStorage());
  const app = RJApp.createApp({
    doc: env.doc, win: env.win, store, core: Core, ui: UI, tags: Tags,
    seed: opts.seed, random: opts.random
  });
  app._env = env;
  app._store = store;
  app.start();
  // 推荐页默认是分区货架；本文件测的是列表行为，先切到「全部」列表
  go(app, '#/recommend?sec=all');
  return app;
}

function go(app, hash) {
  app._env.win.location.hash = hash;
  app.onHashChange();
}

/* 当前已渲染的卡片 id（按渲染顺序） */
function cardIds(app) {
  return Array.from(app._env.doc.getElementById('view').innerHTML
    .matchAll(/class="card" data-act="open" data-id="([^"]+)"/g)).map((m) => m[1]);
}

function viewHtml(app) {
  return app._env.doc.getElementById('view').innerHTML;
}

/* 造一个可滚动的假视口 */
function viewport(app, top, content, height) {
  const v = app._env.doc.getElementById('view');
  v.clientHeight = height || 600;
  v.scrollHeight = content;
  v.scrollTop = top;
  return v;
}

test('加载更多：追加一批且不重复，已加载部分顺序不变', () => {
  const app = makeApp({ seed: 111 });
  const first = cardIds(app);
  assert.equal(first.length, 30);
  assert.ok(viewHtml(app).includes('已显示 30 / ' + DRINKS.length));

  click(app._env.doc, { 'data-act': 'loadMore' });
  const all = cardIds(app);
  assert.equal(app.state.shown, 60);
  assert.equal(all.length, 60);
  assert.equal(new Set(all).size, 60, '同一列表内不得重复');
  assert.deepEqual(all.slice(0, 30), first, '已加载的前 30 条顺序不变');
});

test('触底自动追加一批，且不会一次连跳多批', () => {
  const app = makeApp({ seed: 111 });
  const v = viewport(app, 2600, 3000);      // 距底 200 < 240

  v.dispatch('scroll', {});
  assert.equal(app.state.shown, 60, '触底应追加一批');

  v.dispatch('scroll', {});                 // 仍在底部、未重新武装
  assert.equal(app.state.shown, 60, '同一次驻留底部不得连续追加');

  v.scrollTop = 0; v.dispatch('scroll', {});            // 离开触底区 → 重新武装
  viewport(app, 5600, 6000).dispatch('scroll', {});
  assert.equal(app.state.shown, 90, '重新武装后可再追加');
});

test('非推荐页滚动不追加', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  viewport(app, 2600, 3000).dispatch('scroll', {});
  assert.equal(app.state.shown, 30, '酒柜页滑动不应影响推荐页');
});

test('结果集不足一批时不再追加，底部不再有加载更多', () => {
  const app = makeApp({ seed: 111 });
  const input = app._env.doc.getElementById('searchInput');
  input.value = '莫';
  input.dispatch('input', { target: input });
  click(app._env.doc, { 'data-act': 'loadMore' });

  const total = app.state.lastTotal;
  assert.ok(total > 0 && total <= 30, '单字结果应在一批以内，实际 ' + total);
  assert.equal(app.state.shown, 30);
  assert.equal(cardIds(app).length, total);
  assert.ok(viewHtml(app).includes('共 ' + total + ' 款'));
  assert.ok(!viewHtml(app).includes('data-act="loadMore"'), '已到末尾不该再有「加载更多」');
});

test('换一批：重新洗牌、回到第一批、回到顶部', () => {
  const app = makeApp({ seed: 111, random: () => 0.0001 });
  const v = viewport(app, 2600, 3000);
  v.dispatch('scroll', {});
  assert.equal(app.state.shown, 60);
  const before = cardIds(app);

  click(app._env.doc, { 'data-act': 'refreshList' });
  assert.equal(app.state.shown, 30);
  assert.equal(v.scrollTop, 0, '换一批应回到顶部');
  const after = cardIds(app);
  assert.equal(after.length, 30);
  assert.equal(new Set(after).size, 30);
  assert.notDeepEqual(after, before.slice(0, 30), '换一批应换顺序');
});

test('筛选变化回到第一批', () => {
  const app = makeApp({ seed: 111 });
  viewport(app, 2600, 3000).dispatch('scroll', {});
  assert.equal(app.state.shown, 60);

  click(app._env.doc, { 'data-act': 'fStr', 'data-val': 'none' });
  assert.equal(app.state.shown, 30, '改筛选应回到第一批');
  assert.equal(app._env.doc.getElementById('view').scrollTop, 0);
});

test('进详情再返回：已加载条数与滚动位置都恢复', () => {
  const app = makeApp({ seed: 111 });
  const v = viewport(app, 2600, 3000);
  v.dispatch('scroll', {});
  assert.equal(app.state.shown, 60);

  v.scrollTop = 4200;                       // 用户继续下滚
  const backTo = app._env.win.location.hash;

  click(app._env.doc, { 'data-act': 'open', 'data-id': DRINKS[0].id });
  app.onHashChange();
  assert.equal(app.state.route.page, 'drink');
  assert.equal(v.scrollTop, 0, '进详情应回到顶部');

  click(app._env.doc, { 'data-act': 'toggle', 'data-id': DRINKS[0].id });   // 加入酒柜
  go(app, backTo);                          // 模拟浏览器返回
  assert.equal(app.state.route.page, 'recommend');
  assert.equal(app.state.shown, 60, '返回后仍保持已加载条数');
  assert.equal(v.scrollTop, 4200, '返回后应恢复原滚动位置');
});

test('从酒柜回到推荐页不恢复旧滚动位置', () => {
  const app = makeApp({ seed: 111 });
  const v = viewport(app, 2600, 3000);
  v.dispatch('scroll', {});
  v.scrollTop = 4200;
  click(app._env.doc, { 'data-act': 'open', 'data-id': DRINKS[0].id });
  app.onHashChange();

  go(app, '#/cabinet');
  assert.equal(app.state.shown, 30, '切到酒柜应放弃待恢复的滚动位置');
  go(app, '#/recommend');
  assert.equal(v.scrollTop, 0, '再回推荐页应从顶部开始');
});
