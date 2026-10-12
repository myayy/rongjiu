'use strict';

/* P17：酒柜页布局
   酒柜页固定为「抖音『我』页」范式：顶部吸顶信息区（统计卡 + 我的材料入口）
   → 3 个 Tab（酒柜 / 喝过 / 能做）→ 中部可滑动列表 → 底部浏览历史入口。
   曾经并存过的「经典单列布局」与夹层切换按钮已整体下线，本文件守住这一点。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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

/* ---------- ① 经典布局与切换入口已整体下线 ---------- */
test('经典布局已下线：ui 不再导出 cabinetHtml / pantryPanelHtml', () => {
  assert.equal(UI.cabinetHtml, undefined, '经典布局 builder 应删除');
  assert.equal(UI.pantryPanelHtml, undefined, '内嵌材料面板应删除');
  assert.equal(typeof UI.pantrySheetHtml, 'function', '材料改走弹层');
  assert.equal(typeof UI.cabinetProfileHtml, 'function');
  assert.equal(typeof UI.cabinetProfileParts, 'function');
});

test('经典布局已下线：index.html 里没有夹层切换按钮', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('btnLayout'), '不该再有夹层按钮');
  assert.ok(!html.includes('switchbar'), '不该再有夹层容器');
  assert.ok(!html.includes('layout-btn'));
  assert.ok(html.includes('id="view"'), '页面容器照旧');
});

test('经典布局已下线：store 不再提供布局偏好 API，旧 settings 里的遗留键读时被清掉', () => {
  const storage = RJStore.memoryStorage();
  // 模拟旧版本留下的偏好 + 一个正常设置项
  storage.setItem(RJStore.KEYS.settings, JSON.stringify({
    cabinetLayout: 'profile',
    priceTiers: [{ min: 0, max: 9, label: '便宜' }]
  }));
  const s = RJStore.createStore(storage);
  assert.equal(s.getCabinetLayout, undefined, '不该再有 getCabinetLayout');
  assert.equal(s.setCabinetLayout, undefined, '不该再有 setCabinetLayout');

  const st = s.getSettings();
  assert.equal(st.cabinetLayout, undefined, '遗留键应被清掉');
  assert.ok(Array.isArray(st.priceTiers), '其它设置项不受影响');
  assert.equal(JSON.parse(storage.getItem(RJStore.KEYS.settings)).cabinetLayout, undefined,
    '清掉的键要落盘，别跟着备份到处跑');
  assert.equal(s.exportBackup().settings.cabinetLayout, undefined, '导出备份也不该带出来');
});

test('经典布局已下线：旧动作 toggleCabinetLayout 不再改变任何状态', () => {
  const app = makeApp({ seed: 1 });
  app.handleAction('toggleCabinetLayout', null);
  assert.equal(app._store.getSettings().cabinetLayout, undefined);
  go(app, '#/cabinet');
  assert.ok(viewHtml(app).includes('class="cab-profile"'), '酒柜页只有一种布局');
});

/* ---------- ② 页面结构 ---------- */
test('酒柜页：固定信息区 + 统计卡四格 + 三个 Tab + 材料入口 + 历史入口', () => {
  const html = UI.cabinetProfileHtml({
    pantry: ['朗姆酒', '可乐'],
    cabinet: [{ id: 'x', name_display: '测试酒' }],
    rated: [],
    history: [{}, {}, {}],
    ready: [],
    near: [],
    tab: 'cabinet'
  }, Tags);
  assert.ok(html.includes('class="profile-head"'), '顶部信息区');
  assert.ok(html.includes('class="profile-stats"'), '统计卡');
  // 四格统计：酒柜 1 / 喝过 0 / 材料 2 / 浏览 3
  assert.ok(/ps-num">1</.test(html), '酒柜数应为 1');
  assert.ok(html.includes('ps-label">材料'), '材料标签');
  assert.ok(/ps-num">2</.test(html), '材料数应为 2');
  assert.ok(/ps-num">3</.test(html), '浏览数应为 3');
  assert.ok(html.includes('data-act="openPantry"'), '我的材料入口');
  assert.ok(html.includes('data-act="cabTab" data-val="cabinet"'));
  assert.ok(html.includes('data-act="cabTab" data-val="rated"'));
  assert.ok(html.includes('data-act="cabTab" data-val="makeable"'));
  assert.ok(html.includes('data-act="gotoHistory"'), '底部功能入口');
});

test('酒柜页：中部列表按 Tab 三选一', () => {
  const base = {
    pantry: ['朗姆酒'],
    cabinet: [DRINKS[0]],
    rated: [{ drink: DRINKS[1], rating: 4 }],
    history: [],
    ready: [],
    near: []
  };
  const cab = UI.cabinetProfileHtml(Object.assign({ tab: 'cabinet' }, base), Tags);
  assert.ok(cab.includes('我的酒柜（1 瓶）'), '酒柜 Tab 显示收藏列表');
  assert.ok(!cab.includes('喝过的酒（1）'), '酒柜 Tab 不该混进喝过的酒');

  const rated = UI.cabinetProfileHtml(Object.assign({ tab: 'rated' }, base), Tags);
  assert.ok(rated.includes('喝过的酒（1）'));
  assert.ok(rated.includes('data-act="rate"'), '仍带星级控件');
  assert.ok(!rated.includes('我的酒柜（1 瓶）'));

  const make = UI.cabinetProfileHtml(Object.assign({ tab: 'makeable' }, base), Tags);
  assert.ok(make.includes('<h3>能做的酒</h3>'));
  assert.ok(make.includes('rulenote'), '规则说明必须保留');
});

test('酒柜页：喝过的酒为空时给空态，不是一片空白', () => {
  const html = UI.cabinetProfileHtml({
    pantry: [], cabinet: [], rated: [], history: [], ready: [], near: [], tab: 'rated'
  }, Tags);
  assert.ok(html.includes('还没有评价过的酒'));
});

test('酒柜页：没录材料时「能做」Tab 也要有说法', () => {
  const html = UI.cabinetProfileHtml({
    pantry: [], cabinet: [], rated: [], history: [], ready: [], near: [], tab: 'makeable'
  }, Tags);
  assert.ok(html.includes('先录入家里现有的材料'), '实际：' + html.slice(-260));
});

/* ---------- ③ 页面交互 ---------- */
test('酒柜页：切 Tab 只换中部列表与 Tab 栏', () => {
  const app = makeApp({ seed: 1 });
  app._store.addCabinet(DRINKS[0].id);
  app._store.setRating(DRINKS[1].id, 4);
  go(app, '#/cabinet');

  // 假 DOM 不解析 innerHTML，所以整页状态看 view，切 Tab 后的定点更新看 #cabTabs / #cabList
  const page = viewHtml(app);
  assert.ok(page.includes('class="cab-profile"'));
  assert.ok(page.includes('data-act="cabTab" data-val="cabinet"'));
  assert.ok(page.includes('我的酒柜（1 瓶）'));

  const tabsEl = app._env.doc.getElementById('cabTabs');
  const listEl = app._env.doc.getElementById('cabList');
  app.handleAction('cabTab', { getAttribute: () => 'rated' });
  assert.equal(app.state.cabinetTab, 'rated');
  assert.ok(listEl.innerHTML.includes('喝过的酒'), '实际：' + listEl.innerHTML.slice(0, 160));
  const ratedTab = /<button class="[^"]*"[^>]*data-val="rated"/.exec(tabsEl.innerHTML);
  assert.ok(ratedTab, '应能找到 rated 这个 Tab：' + tabsEl.innerHTML);
  assert.ok(/profile-tab on/.test(ratedTab[0]), 'rated 应被高亮：' + ratedTab[0]);
});

test('酒柜页：我的材料走弹层，加材料后弹层与统计卡同步更新', () => {
  const app = makeApp({ seed: 1 });
  go(app, '#/cabinet');
  assert.ok(!viewHtml(app).includes('id="pantryInput"'), '页面里不该内嵌材料输入框');

  app.handleAction('openPantry', null);
  const ov = app._env.doc.getElementById('overlay');
  assert.equal(app.state.overlay, 'pantry');
  assert.ok(ov.innerHTML.includes('id="pantryInput"'), '弹层里应有材料输入框');
  // 收进弹层必须给退路：套 .sheet 外壳 + 显式「关闭」按钮（遮罩点击也关）
  assert.ok(ov.innerHTML.includes('class="sheet"'), '弹层应有 .sheet 外壳');
  assert.ok(ov.innerHTML.includes('data-act="closeOverlay"'), '弹层应有「关闭」按钮');

  app._env.doc.getElementById('pantryInput').value = '朗姆酒';
  app.handleAction('addPantry', null);
  assert.ok(ov.innerHTML.includes('朗姆酒'), '加完材料弹层要刷新：' + ov.innerHTML.slice(0, 240));
  assert.ok(/ps-num">1</.test(viewHtml(app)), '顶部统计卡的材料数要同步');
});

test('酒柜页：删材料后页面与弹层都刷新', () => {
  const app = makeApp({ seed: 1 });
  app._store.addPantry('朗姆酒');
  go(app, '#/cabinet');
  app.handleAction('openPantry', null);

  app.handleAction('delPantry', { getAttribute: () => '朗姆酒' });
  assert.equal(app._store.getPantry().length, 0);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('常见材料'), '弹层要刷新回建议区');
  assert.ok(/ps-num">0</.test(viewHtml(app)), '统计卡要归零');
});

test('酒柜页：录入材料后「能做」Tab 分「材料齐全 / 还差 1 样」两组', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  app._store.addPantry('朗姆酒');
  app.render();

  click(app._env.doc, { 'data-act': 'cabTab', 'data-val': 'makeable' });
  const html = app._env.doc.getElementById('cabList').innerHTML;
  assert.ok(html.includes('<h3>能做的酒</h3>'));
  assert.ok(html.includes('材料齐全') || html.includes('还差 1 样'));
  assert.ok(html.includes('rulenote'), '规则说明必须保留');
});

/* ---------- ④ 与既有结构不冲突 ---------- */
test('底部导航仍是三个 tab（酒柜布局没有额外的导航入口）', () => {
  const app = makeApp({ seed: 1 });
  const tabs = app._env.doc.querySelectorAll('.tab');
  assert.equal(tabs.length, 3);
  assert.deepEqual(tabs.map((t) => t.getAttribute('data-tab')), ['recommend', 'cabinet', 'box']);
});

test('设置弹层里不再需要主题开关（单一暗黑星空主题）', () => {
  const app = makeApp({ seed: 1 });
  app.handleAction('settings', null);
  const html = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(!html.includes('toggleTheme'));
  assert.ok(!html.includes('切换为'));
});
