'use strict';

/* P15：体验优化清单落地
   H1 能做的酒规则说明 / H2 基酒视图 / H3 精确匹配+搜索历史 /
   H4 盲盒默认全选 / H5 自制编辑 / 单一主题 / 覆盖导入确认 / 备份提醒 */

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
  if (opts.tiers) store.setPriceTiers(opts.tiers);
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

/* H1：能做的酒规则说明 */
test('H1 能做的酒顶部有规则说明', () => {
  const html = UI.makeableHtml([], [], Tags, ['朗姆酒']);
  assert.ok(html.includes('仅展示「材料齐全」或只差 1 样材料的配方'), '应有规则说明');
  assert.ok(html.includes('缺 2 样及以上的不会在此显示'));
});

/* H2：基酒视图 */
test('H2 基酒总览可进入，点某个基酒列出全部用到它的配方', () => {
  const app = makeApp({ seed: 1 });
  go(app, '#/recommend?sec=spirits');
  const idx = viewHtml(app);
  assert.ok(idx.includes('全部基酒'));
  assert.ok(idx.includes('data-spirit="vodka"'));
  assert.ok(idx.includes('data-spirit="rum"'));

  go(app, '#/recommend?sec=spirits&spirit=vodka');
  const v = viewHtml(app);
  const cards = Array.from(v.matchAll(/class="card" data-act="open" data-id="([^"]+)"/g)).map((m) => m[1]);
  assert.ok(cards.length > 0, '伏特加基酒下应有配方');
  for (const id of cards) {
    assert.ok(Tags.spiritIdsOf(app._store.findRecipe(id)).includes('vodka'), id + ' 应用到伏特加');
  }
});

test('H2 纳入伏特加但被分进咖啡分区的酒，在基酒视图里也能找到', () => {
  // 找一个用了伏特加但 sectionOf 是 coffee/其它 的样本
  const pick = DRINKS.find((d) => Tags.spiritIdsOf(d).includes('vodka') && Tags.sectionOf(d) !== 'vodka');
  if (!pick) return;   // 数据里没有这种样本也放行
  const g = Tags.groupBySpirit(DRINKS).find((s) => s.id === 'vodka');
  assert.ok(g.drinks.some((d) => d.id === pick.id), '基酒视图应包含这款');
});

/* H3：精确匹配 */
test('H3 精确匹配只按酒名整串命中', () => {
  const list = Core.filterRecipes(DRINKS, { q: '金', exact: true }, Tags);
  assert.ok(list.length > 0);
  for (const d of list) assert.ok(String(d.name_display).includes('金'));
});

test('H3 搜索历史：去重、点历史词即可搜', () => {
  const store = RJStore.createStore(RJStore.memoryStorage());
  store.pushSearchHistory('莫吉托');
  store.pushSearchHistory('莫吉托');
  store.pushSearchHistory('威士忌');
  assert.deepEqual(store.getSearchHistory(), ['威士忌', '莫吉托']);
  assert.ok(UI.searchHistoryHtml(store.getSearchHistory()).includes('data-act="searchHist"'));
});

/* H4：盲盒默认全选 */
test('H4 盲盒默认全选；点一下即取消该档', () => {
  const app = makeApp({ seed: 1 });
  go(app, '#/box');
  assert.equal(app.state.blind.tierIds, null, '默认未动过');
  assert.equal(app.state.pool.length, DRINKS.length, '默认全选 → 全库');
  const ids = Tags.normalizeTiers(app._store.getPriceTiers()).map((t) => t.id);
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[0] });
  assert.deepEqual(app.state.blind.tierIds, ids.slice(1), '点一下即取消低档');
  assert.ok(app.state.pool.length < DRINKS.length, '排除低档后池子变小');
});

/* H5：自制配方编辑 */
test('H5 编辑自制配方：回填、保存覆盖、保留 id', () => {
  const app = makeApp({ seed: 1 });
  const rec = app._store.addCustom({ name_zh: '旧名字', ingredients_zh: ['30毫升伏特加'], category: '', alcoholic: '', glass: '', image: '' });
  click(app._env.doc, { 'data-act': 'editCustom', 'data-id': rec.id });
  assert.equal(app.state.overlay, 'newRecipe');
  const ov = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(ov.includes('编辑自制配方'));
  assert.ok(ov.includes('旧名字'), '名称应回填');
  assert.ok(ov.includes('30毫升伏特加'), '配料应回填');

  app._env.doc.getElementById('fName').value = '新名字';
  app._env.doc.getElementById('fIng').value = '45毫升金酒';
  assert.equal(app.saveRecipe().ok, true);
  const updated = app._store.findRecipe(rec.id);
  assert.equal(updated.name_display, '新名字');
  assert.deepEqual(updated.ingredients_zh, ['45毫升金酒']);
  assert.equal(app._store.getCustom().length, 1, '覆盖而非新增');
});

/* 单一主题：改为暗黑星空后不再有明暗切换 */
test('单一模式：设置里没有主题切换项，store 也不再保存主题', () => {
  const app = makeApp({ seed: 1 });
  app.handleAction('settings', null);
  const ov = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(!ov.includes('toggleTheme'), '设置里不该再有主题切换入口');
  assert.ok(!ov.includes('切换为'), '设置里不该再有明暗模式提示');
  assert.equal(app._store.getTheme, undefined, 'store 不再提供 getTheme');
  assert.equal(app._store.setTheme, undefined, 'store 不再提供 setTheme');
  assert.equal(RJStore.KEYS.theme, undefined, '不再有 rj.theme 键');
});

/* 覆盖导入确认 */
test('覆盖导入先进风险确认层', () => {
  const app = makeApp({ seed: 1 });
  app.handleAction('importReplace', null);
  assert.equal(app.state.overlay, 'confirm');
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('无法恢复'));
});

/* 超过30天未备份时启动给出提醒 */
test('超过30天未备份时启动给出提醒', () => {
  const now = 2000000000000;   // 2033
  const mem = RJStore.memoryStorage();
  const s = RJStore.createStore(mem);
  s.setLastBackup(now - 40 * 86400000);
  const app = makeApp({ seed: 1, storage: mem, now: () => now });
  assert.ok(app._env.doc.getElementById('toast').textContent.includes('建议导出备份'));
});

/* 详情页分享弹层 */
test('详情页分享弹层可打开，含复制文本 / 生成卡片图', () => {
  const app = makeApp({ seed: 1 });
  go(app, '#/drink/cn-016');
  click(app._env.doc, { 'data-act': 'share', 'data-id': 'cn-016' });
  assert.equal(app.state.overlay, 'share');
  const ov = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(ov.includes('复制文本'));
  assert.ok(ov.includes('生成卡片图'));
});

/* 自制在货架/列表卡片都有 ✎ 编辑按钮 */
test('自制配方卡片带编辑入口（card 与 shelf-card 都有）', () => {
  const d = { id: 'my-x1', name_display: '自制冷饮', name_zh: '自制冷饮', category: '', alcoholic: 'Alcoholic', glass: '', ingredients_zh: ['45毫升伏特加'], image: '' };
  assert.ok(UI.cardHtml(d, {}, Tags).includes('data-act="editCustom"'), 'list 卡片应有编辑');
  assert.ok(UI.shelfCardHtml(d, Tags).includes('data-act="editCustom"'), '货架卡片应有编辑');
  const builtin = DRINKS[0];
  assert.ok(!UI.cardHtml(builtin, {}, Tags).includes('editCustom'), '内置配方不加编辑');
});

/* ---- 搜索能匹配界面上的分区标题（「中国饮料兑酒」这类） ---- */
test('searchText：把所属分区名并入可搜索全文', () => {
  const cn = DRINKS.find((d) => String(d.id).indexOf('cn-') === 0);
  assert.ok(cn, '应有 cn- 兑酒配方');
  const text = Tags.searchText(cn);
  assert.ok(text.includes('中国饮料兑酒'), '应含分区标题，实际: ' + text.slice(0, 80));
  // 分区标题是有「中国」前缀的，而数据里的 category 只有「饮料兑酒」
  assert.ok(text.includes('饮料兑酒'));
});

test('照着分区标题搜能搜到（「中国饮料兑酒」36 条）', () => {
  const hit = DRINKS.filter((d) => Tags.searchText(d).includes('中国饮料兑酒'));
  assert.equal(hit.length, 36);
  assert.ok(hit.every((d) => String(d.id).indexOf('cn-') === 0));
  // 各分区标题都应可搜
  for (const [label, n] of [['一口闷 Shot', 74], ['无酒精特调', 271], ['伏特加调酒', 217]]) {
    const h = DRINKS.filter((d) => Tags.searchText(d).includes(label.toLowerCase()));
    assert.equal(h.length, n, label + ' 应命中 ' + n + ' 条');
  }
});

test('酒柜页没有搜索框（该功能已按需求移除）', () => {
  const app = makeApp({ seed: 1 });
  app._store.addCabinet('cn-001');
  go(app, '#/cabinet');
  const html = viewHtml(app);
  assert.ok(html.includes('我的酒柜（1 瓶）'), '收藏列表照常渲染');
  assert.ok(html.includes('雪碧伏特加'), '收藏的兑酒应在列表里');
  assert.ok(!html.includes('id="cabinetQ"'), '不该再有酒柜搜索框');
  assert.ok(!html.includes('data-cabinet-q'), '不该再有搜索框的挂点');
  assert.ok(!html.includes('data-act="cabMode"'), '不该再有排序开关');
  assert.ok(!html.includes('data-act="searchAll"'), '不该再有跳转按钮');
});