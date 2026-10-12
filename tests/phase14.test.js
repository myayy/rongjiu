'use strict';

/* P14：手机端三处修复
   ① 主界面搜索：打字只刷新列表区，不重建输入框（中文输入法组词会被打断）
   ② 我的材料：读输入框实时值、不静默失败、能做的酒给空态
   ③ 安卓返回键：应用内先回退，没得退了才退出应用 */

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

/* ========== ① 搜索：不重建输入框 ========== */

test('搜索组词中（isComposing）不重渲染，避免打断中文输入法', () => {
  const app = makeApp({ seed: 111 });
  const before = viewHtml(app);
  const input = app._env.doc.getElementById('searchInput');
  input.value = 'mo';
  input.dispatch('input', { target: input, isComposing: true });
  assert.equal(app.state.q, 'mo', '查询词要先记下来');
  assert.equal(viewHtml(app), before, '组词期间界面不该动');
  assert.ok(before.includes('class="shelf"'), '仍是货架首页');

  // 组词结束 → 补一次渲染，切到列表形态
  input.dispatch('compositionend', { target: input });
  const after = viewHtml(app);
  assert.ok(after.includes('id="listBox"'), '组词结束后应切到列表形态');
  assert.ok(after.includes('id="searchInput"'), '搜索框仍在');
});

test('真实 DOM 里打字只换列表区：搜索框节点不变（手机上不会掉焦点）', () => {
  const app = makeApp({ seed: 111 });
  const doc = app._env.doc;
  // 让 #filterHost / #listWrap 看起来像真的挂在文档上（假 DOM 默认没有 parentNode）
  doc.getElementById('view').appendChild(doc.getElementById('filterHost'));
  doc.getElementById('view').appendChild(doc.getElementById('listWrap'));

  const input = doc.getElementById('searchInput');
  const host = doc.getElementById('filterHost');
  const wrap = doc.getElementById('listWrap');
  input.value = '莫吉托';
  input.dispatch('input', { target: input });

  assert.equal(app.state.q, '莫吉托');
  assert.ok(wrap.innerHTML.includes('莫吉托'), '结果区应已更新');
  assert.equal(host.className, 'filter-host', '筛选条容器保持稳定，打字不重建搜索框');
  assert.ok(app._env.win.location.hash.includes('q='), '搜索词要写回 URL');
});

test('货架首页也带搜索胶囊与筛选入口', () => {
  const app = makeApp({ seed: 111 });
  const html = viewHtml(app);
  assert.ok(html.includes('class="filter-host"'), '首页应有筛选条容器');
  assert.ok(html.includes('id="searchInput"'), '首页要有搜索框');
  assert.ok(html.includes('data-act="openFilter"'), '首页要有筛选入口');
});

/* ========== ② 我的材料 ========== */

test('材料：输入框里有字但草稿是空的，点＋也能加上（不依赖 input 事件）', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  app.handleAction('openPantry', null);
  const input = app._env.doc.getElementById('pantryInput');
  input.value = '冰红茶';
  // 故意不发 input 事件，模拟手机输入法/自动填充漏掉 input 的情况
  assert.equal(app.state.pantryDraft, '');
  click(app._env.doc, { 'data-act': 'addPantry' });
  assert.deepEqual(app._store.getPantry(), ['冰红茶']);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('data-val="冰红茶"'), '应出现材料胶囊');
});

test('材料：空输入点＋不再静默，给出提示', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  const input = app._env.doc.getElementById('pantryInput');
  input.value = '   ';
  click(app._env.doc, { 'data-act': 'addPantry' });
  assert.deepEqual(app._store.getPantry(), []);
  const toast = app._env.doc.getElementById('toast');
  assert.ok(toast.textContent.includes('请先输入材料名'), '要有明确提示，实际：' + toast.textContent);
});

test('能做的酒：一款都做不了时给出空态说明', () => {
  const html = UI.makeableHtml([], [], Tags, ['宇宙牌咖啡因']);
  assert.ok(html.includes('<h3>能做的酒</h3>'), '仍要显示「能做的酒」标题');
  assert.ok(html.includes('暂时没有能做的酒'), '要说清楚为什么没有，实际：' + html.slice(0, 260));
  assert.ok(html.includes('宇宙牌咖啡因'), '把用户录的材料回显出来');
});

test('能做的酒：还不齐但能凑（只有「还差 1 样」）时，材料齐全也显式说明 0 款', () => {
  const html = UI.makeableHtml([], [{ drink: DRINKS[0], missing: '威士忌' }], Tags, ['冰红茶']);
  assert.ok(html.includes('材料齐全（0）'), '该明说现在一款都做不出来');
  assert.ok(html.includes('还差 1 样（1）'));
  assert.ok(!html.includes('暂时没有能做的酒'));
});

test('能做的酒：有结果时照旧显示两组，不显示空态文案', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  app._store.addPantry('朗姆酒');
  app.render();
  app.handleAction('cabTab', { getAttribute: () => 'makeable' });
  const html = app._env.doc.getElementById('cabList').innerHTML;
  assert.ok(html.includes('还差 1 样（') || html.includes('材料齐全（'));
  assert.ok(!html.includes('暂时没有能做的酒'));
});

test('能做的酒：只差一样、但跟我手上的材料毫无关系的，不能推荐', () => {
  // 「纯威士忌一口饮」只有一样材料。以前不管用户录了什么，它都会顶着「还差 1 样」冒出来
  const onlyWhisky = { id: 'z', ingredients_zh: ['威士忌（45 毫升）'] };
  const g = Tags.pantryGroups([onlyWhisky], ['冰红茶']);
  assert.equal(g.ready.length, 0);
  assert.equal(g.near.length, 0, '跟冰红茶毫不相干，不该出现在「还差 1 样」里');
});

test('材料匹配是「配方材料包含你填的词」的单向判定', () => {
  // 你填「朗姆酒」→ 命中配方的「白朗姆酒」（配方材料更长，包含你填的）
  assert.ok(Tags.ingMatches('白朗姆酒', '朗姆酒'), '朗姆酒应命中白朗姆酒');
  assert.ok(Tags.ingMatches('冰红茶', '冰红茶'), '自己命中自己');
  // 反向不算：配方材料「茶」/「红茶」不该被你填的「冰红茶」命中
  assert.ok(!Tags.ingMatches('茶', '冰红茶'), '配方「茶」不该被「冰红茶」命中');
  assert.ok(!Tags.ingMatches('红茶', '冰红茶'), '配方「红茶」不该被「冰红茶」命中');
  assert.ok(!Tags.ingMatches('朗姆酒', '白朗姆酒'), '配方「朗姆酒」不该被「白朗姆酒」命中');
});

test('能做的酒：录「冰红茶」不会因为配方里有「茶」就瞎推', () => {
  // 库里含「冰红茶」的 4 款兑酒同时还要基酒和柠檬（差 2 样以上），所以一款都不该推荐
  const g = Tags.pantryGroups(DRINKS, ['冰红茶']);
  assert.equal(g.ready.length, 0);
  assert.equal(g.near.length, 0, '不该因为配方材料是「茶」就被推出来');
  const names = g.near.map((x) => x.drink.name_display).join();
  assert.ok(!names.includes('草药火焰'), '「草药火焰」（配料只有热丹姆+茶）不该出现');
});

/* ========== ③ 安卓返回键 ========== */

test('返回键：先关弹层，再退页面，最后才交还给系统退出', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/recommend?sec=rum');
  assert.ok(viewHtml(app).includes('伏特加调酒') === false, '当前是朗姆分区');

  // 弹层优先
  app.handleAction('settings', null);
  assert.equal(app.state.overlay, 'settings');
  assert.equal(app.back(), 'overlay');
  assert.equal(app.state.overlay, null, '弹层应被关掉');

  // 分区列表 → 回货架首页
  assert.equal(app.state.route.q.sec, 'rum');
  assert.equal(app.back(), 'back');
  app.onHashChange();
  assert.ok(viewHtml(app).includes('class="shelf"'), '应回到货架首页');

  // 货架首页 → 没得退了
  assert.equal(app.back(), 'exit');
});

test('返回键：详情页 / 历史页退回上一层，不会直接退出应用', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/drink/cn-016');
  assert.equal(app.state.route.page, 'drink');
  assert.equal(app.back(), 'back');

  go(app, '#/history');
  assert.equal(app.state.route.page, 'history');
  assert.equal(app.back(), 'back');
});

test('返回键：搜索结果态退回货架首页并清掉搜索词', () => {
  const app = makeApp({ seed: 111 });
  const input = app._env.doc.getElementById('searchInput');
  input.value = '莫吉托';
  input.dispatch('input', { target: input });
  assert.equal(app.state.q, '莫吉托');

  assert.equal(app.back(), 'back');
  app.onHashChange();
  assert.equal(app.state.q, '');
  assert.ok(viewHtml(app).includes('class="shelf"'), '应回到货架首页');
});
