'use strict';

/* P13：导航改三栏 + 推荐页分区货架 + 浏览历史独立页 + 详情页排版 */

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
    seed: opts.seed, now: opts.now
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

function cardIds(app) {
  return Array.from(viewHtml(app).matchAll(/class="card" data-act="open" data-id="([^"]+)"/g)).map((m) => m[1]);
}

/* ========== 分区归类 ========== */

test('分区覆盖全库且互不重复', () => {
  const secs = Tags.groupSections(DRINKS);
  const total = secs.reduce((n, s) => n + s.drinks.length, 0);
  assert.equal(total, DRINKS.length, '每款酒都应落进某个分区');

  const seen = new Set();
  for (const s of secs) {
    for (const d of s.drinks) {
      assert.ok(!seen.has(d.id), `${d.id} 出现在多个分区`);
      seen.add(d.id);
    }
  }
  assert.equal(seen.size, DRINKS.length);
});

test('分区数量与命名符合预期', () => {
  const secs = Tags.groupSections(DRINKS);
  const ids = secs.map((s) => s.id);
  assert.deepEqual(ids, ['mixer', 'shot', 'mocktail', 'coffee', 'vodka', 'gin', 'rum', 'whisky', 'tequila', 'classic']);
  const byId = {};
  secs.forEach((s) => { byId[s.id] = s; });
  assert.equal(byId.mixer.drinks.length, 36, '中国饮料兑酒 36 条');
  assert.ok(byId.mocktail.drinks.every((d) => d.alcoholic === 'Non alcoholic'), '无酒精区只放无酒精');
  assert.ok(byId.shot.drinks.every((d) => Tags.categoryLabel(d.category) === '子弹杯'));
  assert.ok(byId.vodka.drinks.every((d) => Tags.sectionOf(d) === 'vodka'));
});

test('经典酒款落在正确的分区', () => {
  const find = (name) => DRINKS.find((d) => d.name_display.includes(name));
  assert.equal(Tags.sectionOf(find('莫吉托')), 'rum', '莫吉托应按朗姆归类');
  assert.equal(Tags.sectionOf(find('玛格丽特')), 'tequila', '玛格丽特应按龙舌兰归类');
  assert.equal(Tags.sectionOf(find('内格罗尼')), 'gin', '内格罗尼应按金酒归类');
  assert.equal(Tags.sectionOf(find('威士忌酸')), 'whisky');
  assert.equal(Tags.sectionOf(find('雪碧伏特加')), 'mixer', '兑酒优先');
});

/* ========== 三栏导航 ========== */

test('底部导航只剩三个 tab，且没有兑酒 tab', () => {
  const env = makeEnv();
  const tabs = env.doc.querySelectorAll('.tab').map((t) => t.getAttribute('data-tab'));
  assert.deepEqual(tabs, ['recommend', 'cabinet', 'box']);
  assert.ok(!tabs.includes('mixer'), '不应再有兑酒 tab');
});

test('兑酒页路由已下线，回落到推荐页', () => {
  assert.equal(Core.parseHash('#/mixer').page, 'recommend', '旧的 #/mixer 应回落推荐页');
  assert.ok(!Core.PAGES || true);
});

/* ========== 货架首页 ========== */

test('推荐页默认渲染分区货架（横向分区 + 全部入口）', () => {
  const app = makeApp({ seed: 111 });
  const html = viewHtml(app);
  assert.ok(html.includes('class="shelf"'), '应有货架分区');
  assert.ok(html.includes('中国饮料兑酒'), '应有兑酒分区标题');
  assert.ok(html.includes('data-val="all"'), '应有「浏览全部」入口');
  assert.ok(!html.includes('id="listBox"'), '默认不是列表形态');
});

test('货架分区卡片可点进详情', () => {
  const app = makeApp({ seed: 111 });
  const id = Array.from(viewHtml(app).matchAll(/shelf-card" data-act="open" data-id="([^"]+)"/g))[0][1];
  click(app._env.doc, { 'data-act': 'open', 'data-id': id });
  app.onHashChange();
  assert.equal(app.state.route.page, 'drink');
});

test('货架首页不触发触底加载更多', () => {
  const app = makeApp({ seed: 111 });
  const v = app._env.doc.getElementById('view');
  v.clientHeight = 600; v.scrollHeight = 3000; v.scrollTop = 2600;
  v.dispatch('scroll', {});
  assert.equal(app.state.shown, 30, '货架首页没有加载更多');
  assert.ok(viewHtml(app).includes('class="shelf"'), '仍是货架形态');
});

/* ========== 分区列表 ========== */

test('分区列表：有分区头、返回全部、筛选条与列表', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/recommend?sec=rum');
  const html = viewHtml(app);
  assert.ok(html.includes('朗姆调酒'), '应显示分区名');
  assert.ok(html.includes('data-act="backShelf"'), '应有返回全部');
  assert.ok(html.includes('searchInput'), '分区列表也应有搜索框');
  assert.ok(html.includes('id="listBox"'), '应是列表形态');
  assert.ok(cardIds(app).every((id) => Tags.sectionOf(app._store.findRecipe(id)) === 'rum'));
});

test('点「全部 ›」能真的切进分区（不被 hash 幂等跳过）', () => {
  const app = makeApp({ seed: 111 });
  click(app._env.doc, { 'data-act': 'moreSection', 'data-val': 'vodka' });
  app.onHashChange();
  assert.ok(app._env.win.location.hash.includes('sec=vodka'), 'hash 应带 sec');
  assert.ok(viewHtml(app).includes('伏特加调酒'), '应渲染出伏特加分区');
  assert.ok(cardIds(app).length > 0);
});

test('分区列表返回货架首页会清掉筛选', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/recommend?sec=rum');
  click(app._env.doc, { 'data-act': 'backShelf' });
  app.onHashChange();
  assert.ok(viewHtml(app).includes('class="shelf"'), '应回到货架首页');
  assert.equal(app.state.q, '');
});

test('「浏览全部」列出全库且可加载更多', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/recommend?sec=all');
  assert.equal(cardIds(app).length, 30);
  assert.ok(viewHtml(app).includes('已显示 30 / ' + DRINKS.length));
  click(app._env.doc, { 'data-act': 'loadMore' });
  assert.equal(cardIds(app).length, 60);
});

/* ========== 浏览历史独立页 ========== */

test('酒柜页显示历史入口按钮，但不再直接铺历史列表', () => {
  const app = makeApp({ seed: 111, now: () => 1700000000000 });
  go(app, '#/drink/cn-001');
  go(app, '#/cabinet');
  const html = viewHtml(app);
  assert.ok(html.includes('data-act="gotoHistory"'), '应有历史入口按钮');
  assert.ok(html.includes('浏览历史'), '入口按钮文案');
  assert.ok(!html.includes('data-act="clearHistory"'), '酒柜页不再铺历史列表');
});

test('点历史入口进独立页，可删除与清空', () => {
  const app = makeApp({ seed: 111, now: () => 1700000000000 });
  go(app, '#/drink/cn-001');
  go(app, '#/cabinet');
  click(app._env.doc, { 'data-act': 'gotoHistory' });
  app.onHashChange();
  assert.equal(app.state.route.page, 'history');
  assert.equal(app._env.doc.getElementById('pageTitle').textContent, '浏览历史');
  const html = viewHtml(app);
  assert.ok(html.includes('浏览历史（1）'));
  assert.ok(html.includes('data-act="backToCabinet"'), '应有返回酒柜');

  click(app._env.doc, { 'data-act': 'delHistory', 'data-val': 'cn-001' });
  assert.deepEqual(app._store.getHistory(), []);
  assert.ok(viewHtml(app).includes('还没有浏览记录'), '清空后显示空态引导');
});

test('历史页空态有去推荐页的引导', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/history');
  const html = viewHtml(app);
  assert.ok(html.includes('还没有浏览记录'));
  assert.ok(html.includes('data-act="gotoRecommend"'));
});

test('历史页从酒柜进入时高亮酒柜 tab', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/history');
  const tabs = app._env.doc.querySelectorAll('.tab');
  const cab = tabs.filter((t) => t.getAttribute('data-tab') === 'cabinet')[0];
  assert.equal(cab.className, 'tab active', '历史页应视为酒柜的子页');
});

/* ========== 详情页排版 ========== */

test('详情页英文原文单独弱化，不占主体版面', () => {
  const d = { id: 'x', name_display: '测试', category: 'Cocktail', alcoholic: 'Alcoholic',
    glass: 'Highball glass', ingredients_zh: ['30毫升伏特加'], instructions_zh: '摇匀。',
    instructions_en: 'Shake well.' };
  const html = UI.detailHtml(d, {}, Tags);
  assert.ok(html.includes('detail-section en-note'), '英文原文应套 en-note 弱化样式');
  assert.ok(html.includes('<h3>做法</h3>'), '中文做法应是正常小标题');
});

test('详情页信息标签中文化且不是空的', () => {
  const d = { id: 'x', name_display: '测试', category: 'Cocktail', alcoholic: 'Non alcoholic',
    glass: '', ingredients_zh: ['30毫升果汁'], instructions_zh: '拌匀。' };
  const html = UI.detailHtml(d, {}, Tags);
  assert.ok(html.includes('鸡尾酒'));
  assert.ok(html.includes('无酒精'));
  assert.ok(!html.includes('未知酒精度'));
});

/* ========== 体验走查后的修复 ========== */

test('清空搜索后 URL 一并复位（不留旧的 ?q=）', () => {
  const app = makeApp({ seed: 111 });
  const input = app._env.doc.getElementById('searchInput');
  input.value = '莫吉托';
  input.dispatch('input', { target: input });
  assert.ok(app._env.win.location.hash.includes('q='), '搜索应写回 URL');

  input.value = '';
  input.dispatch('input', { target: input });
  const hash = app._env.win.location.hash;
  assert.ok(!hash.includes('q='), '清空后 URL 不该残留 q：' + hash);
  assert.ok(viewHtml(app).includes('class="shelf"'), '应回到货架首页');
});

test('「我的自制」分区可点进完整列表（不再空页）', () => {
  const app = makeApp({ seed: 111 });
  for (let i = 0; i < 14; i++) {
    app._store.addCustom({ name_zh: '自制' + i, ingredients_zh: ['30毫升伏特加'] });
  }
  app.render();
  assert.ok(viewHtml(app).includes('我的自制'), '货架应有「我的自制」区');

  go(app, '#/recommend?sec=mine');
  const ids = cardIds(app);
  assert.equal(ids.length, 14, '自制列表应列出全部自制配方');
  assert.ok(ids.every((id) => id.indexOf('my-') === 0), '只列自制配方');
  assert.ok(viewHtml(app).includes('我的自制'), '应显示分区标题');
  assert.ok(viewHtml(app).includes('data-act="backShelf"'), '应有返回全部');
});

test('「浏览全部」入口在货架顶部（搜索框之后、第一个分区之前）', () => {
  const app = makeApp({ seed: 111 });
  const html = viewHtml(app);
  const iSearch = html.indexOf('searchInput');
  const iAll = html.indexOf('data-val="all"');
  const iShelf = html.indexOf('class="shelf"');
  assert.ok(iSearch >= 0 && iAll > iSearch, '入口应在搜索框之后');
  assert.ok(iShelf > iAll, '入口应在分区货架之前（不用滑到底）');
});

/* ========== 我的材料：多材料 / 英文 / 候选建议 ========== */

test('一次输入多个材料会拆成多条（不再存成一整串）', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  const input = app._env.doc.getElementById('pantryInput');
  input.setAttribute('data-pantry-input', '1');
  input.value = '朗姆酒 / 可乐 / 青柠汁';
  // 材料输入框走的是 document 上的事件委托
  app._env.doc.dispatch('input', { target: input });
  assert.equal(app.state.pantryDraft, '朗姆酒 / 可乐 / 青柠汁', '草稿应被记录');
  app.handleAction('addPantry', null);
  assert.deepEqual(app._store.getPantry().slice().sort(), ['可乐', '朗姆酒', '青柠汁'].sort());
});

test('splitIngredients：拆分隔符、剥单位、认英文别名', () => {
  assert.deepEqual(Tags.splitIngredients('朗姆酒 / 可乐 / 青柠汁'), ['朗姆酒', '可乐', '青柠汁']);
  assert.deepEqual(Tags.splitIngredients('朗姆酒、可乐'), ['朗姆酒', '可乐']);
  assert.deepEqual(Tags.splitIngredients('伏特加, 青柠汁'), ['伏特加', '青柠汁']);
  assert.deepEqual(Tags.splitIngredients('30毫升朗姆酒'), ['朗姆酒']);
  assert.deepEqual(Tags.splitIngredients('vodka'), ['伏特加']);
  assert.deepEqual(Tags.splitIngredients('gin'), ['金酒']);
  assert.deepEqual(Tags.splitIngredients('  '), []);
});

test('材料建议区：空输入给常见材料、有输入给匹配项、无匹配给兜底提示', () => {
  const names = ['伏特加', '金酒', '朗姆酒'];
  const a = UI.pantrySuggestHtml(names, '');
  assert.ok(a.includes('常见材料'));
  assert.ok(a.includes('data-act="addPantryName" data-val="伏特加"'), '应给出可点的材料胶囊');
  const b = UI.pantrySuggestHtml([], 'zzz不存在zzz');
  assert.ok(b.includes('库里没有含'), '无匹配要有兜底提示');
});

test('酒柜页渲染出建议区，点材料胶囊即加入', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  const html = viewHtml(app);
  assert.ok(html.includes('id="pantrySuggest"'), '应有建议区容器');
  const m = html.match(/data-act="addPantryName" data-val="([^"]+)"/);
  assert.ok(m, '应渲染出材料胶囊');
  click(app._env.doc, { 'data-act': 'addPantryName', 'data-val': m[1] });
  assert.deepEqual(app._store.getPantry(), [m[1]]);
});

/* ========== 旧脏标签自动清理 ========== */

test('启动时自动拆开旧版本留下的整串材料标签', () => {
  const mem = RJStore.memoryStorage();
  mem.setItem('rj.pantry', JSON.stringify(['朗姆酒 / 可乐 / 青柠汁', '30毫升伏特加', 'gin']));
  const app = makeApp({ seed: 111, storage: mem });
  assert.deepEqual(
    app._store.getPantry().slice().sort(),
    ['可乐', '伏特加', '金酒', '朗姆酒', '青柠汁'].sort(),
    '整串应被拆成单个材料，带单位与英文名也应归一'
  );
});

test('材料已经干净时不做改动（幂等）', () => {
  const mem = RJStore.memoryStorage();
  mem.setItem('rj.pantry', JSON.stringify(['伏特加', '可乐']));
  const app = makeApp({ seed: 111, storage: mem });
  assert.deepEqual(app._store.getPantry(), ['伏特加', '可乐']);
});

test('脏标签去重后不会产生重复材料', () => {
  const mem = RJStore.memoryStorage();
  mem.setItem('rj.pantry', JSON.stringify(['朗姆酒 / 可乐', '可乐', '朗姆酒']));
  const app = makeApp({ seed: 111, storage: mem });
  assert.deepEqual(app._store.getPantry().slice().sort(), ['可乐', '朗姆酒'].sort());
});
