'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeEnv, click, El } = require('./fakedom');

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
  const mem = opts.storage || RJStore.memoryStorage();
  const store = RJStore.createStore(mem);
  if (opts.tiers) store.setPriceTiers(opts.tiers);
  const app = RJApp.createApp({ doc: env.doc, win: env.win, store, core: Core, ui: UI, tags: Tags, seed: opts.seed });
  app._env = env;
  app._store = store;
  app._mem = mem;
  app.start();
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

/* ========== P5/P6：推荐页与酒柜 ========== */

test('启动默认落在推荐页，渲染分区货架与搜索框', () => {
  const app = makeApp();
  assert.equal(app.state.route.page, 'recommend');
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('searchInput'), '应有搜索框');
  assert.ok(html.includes('class="shelf"'), '应有横向分区货架');
  assert.ok(html.includes('class="shelf-card"'), '应有货架卡片');
  assert.ok(html.includes('data-act="refreshList"'), '应有「换一批」按钮');
  assert.ok(html.includes('data-act="moreSection"'), '应有「全部 ›」入口');
  assert.ok(!html.includes('data-act="gotoPage"'), '不应再有页码翻页');
  assert.equal(app._env.doc.getElementById('pageTitle').textContent, '推荐');
  const tabs = app._env.doc.querySelectorAll('.tab');
  assert.equal(tabs[0].className, 'tab active');
});

test('底部导航只有三个：推荐 / 酒柜 / 盲盒', () => {
  const env = makeEnv();
  const tabs = env.doc.querySelectorAll('.tab').map((t) => t.getAttribute('data-tab'));
  assert.deepEqual(tabs, ['recommend', 'cabinet', 'box']);
});

test('搜索输入实时过滤（不整页重渲染，保留输入）', () => {
  const app = makeApp();
  const input = app._env.doc.getElementById('searchInput');
  input.value = '莫吉托';
  input.dispatch('input', { target: input });
  const listBox = app._env.doc.getElementById('listBox');
  assert.ok(listBox.innerHTML.includes('莫吉托'));
  assert.ok(!listBox.innerHTML.includes('僵尸（Zombie）'), '「莫吉托」不该命中「僵尸」');
  assert.equal(app.state.q, '莫吉托');
  assert.equal(app.state.shown, 30);
});

test('搜索排序：酒名完整命中的排在只命中单字的前面', () => {
  const app = makeApp();
  const input = app._env.doc.getElementById('searchInput');
  input.value = '莫吉托';
  input.dispatch('input', { target: input });

  const byId = {};
  app._store.allRecipes().forEach((d) => { byId[d.id] = d; });
  const names = cardIds(app).map((id) => String(byId[id].name_display || ''));
  assert.ok(names.length > 0);
  assert.ok(names[0].includes('莫吉托'), '第一条应是名字里含「莫吉托」的，实际：' + names[0]);

  // 逐字 OR 匹配会把「莫兰吉托」这种也捞进来，但它不该排在「蓝莓莫吉托」前面
  const isExact = names.map((n) => n.includes('莫吉托'));
  const firstOther = isExact.indexOf(false);
  if (firstOther !== -1) {
    const lastExact = isExact.lastIndexOf(true);
    assert.ok(lastExact < firstOther, '名字含「莫吉托」的都要排在只命中单字的前面');
  }
});

test('推荐页筛选：口味 / 材料 / 酒精强度，再次点击取消', () => {
  const app = makeApp();

  click(app._env.doc, { 'data-act': 'fTaste', 'data-val': '甜' });
  assert.deepEqual(app.state.tastes, ['甜']);
  let shown = Core.filterRecipes(app._store.allRecipes(), { tastes: ['甜'] }, Tags);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((d) => Tags.deriveTastes(d).includes('甜')));
  click(app._env.doc, { 'data-act': 'fTaste', 'data-val': '甜' });
  assert.deepEqual(app.state.tastes, []);

  const ings = Tags.commonIngredients(app._store.allRecipes(), 24);
  click(app._env.doc, { 'data-act': 'fIng', 'data-val': ings[0].name });
  assert.deepEqual(app.state.ingredients, [ings[0].name]);
  shown = Core.filterRecipes(app._store.allRecipes(), { ingredients: [ings[0].name] }, Tags);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((d) => Tags.hasIngredient(d, ings[0].name)));
  click(app._env.doc, { 'data-act': 'fIng', 'data-val': ings[0].name });
  assert.deepEqual(app.state.ingredients, []);

  click(app._env.doc, { 'data-act': 'fStr', 'data-val': 'none' });
  assert.equal(app.state.strength, 'none');
  shown = Core.filterRecipes(app._store.allRecipes(), { strength: 'none' }, Tags);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((d) => Tags.strength(d) === 'none'));
  click(app._env.doc, { 'data-act': 'fStr', 'data-val': '' });
  assert.equal(app.state.strength, '');
});

test('筛选状态写回 URL，返回后不丢失', () => {
  const app = makeApp();
  click(app._env.doc, { 'data-act': 'fTaste', 'data-val': '甜' });
  assert.ok(app._env.win.location.hash.includes('tastes='), '筛选应写回 URL: ' + app._env.win.location.hash);
  assert.ok(!app._env.win.location.hash.includes('page='), '不应再有 page 参数');
  const backTo = app._env.win.location.hash;

  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  app.onHashChange();
  go(app, backTo);
  assert.deepEqual(app.state.tastes, ['甜'], '返回后筛选应保留');
  assert.equal(app.state.shown, 30);
});

/* 货架首页的全部卡片 id（按渲染顺序） */
function shelfIds(app) {
  return Array.from(viewHtml(app)
    .matchAll(/shelf-card" data-act="open" data-id="([^"]+)"/g)).map((m) => m[1]);
}

test('推荐页按种子打散：换种子换一批，同种子不变', () => {
  const app1 = makeApp({ seed: 111 });
  const app2 = makeApp({ seed: 222 });
  const app1b = makeApp({ seed: 111 });

  const first = shelfIds(app1);
  assert.ok(first.length > 30, '货架首页应铺出多个分区的卡片');
  assert.notDeepEqual(first, shelfIds(app2), '不同种子顺序应不同');
  assert.deepEqual(first, shelfIds(app1b), '同种子顺序应一致');

  // 进「全部」列表后仍是每批 30 条
  go(app1, '#/recommend?sec=all');
  assert.equal(cardIds(app1).length, 30);
});

test('清除筛选恢复全量并有对应按钮', () => {
  const app = makeApp();
  const input = app._env.doc.getElementById('searchInput');
  input.value = 'qzxqzx';
  input.dispatch('input', { target: input });
  let html = viewHtml(app);
  assert.ok(html.includes('未找到相关配方'));
  assert.ok(html.includes('data-act="clearFilter"'));
  click(app._env.doc, { 'data-act': 'clearFilter' });
  assert.equal(app.state.q, '');
  html = viewHtml(app);
  assert.ok(html.includes('class="shelf"'), '清除筛选后回到分区货架首页');
  assert.equal(app.state.shown, 30);
});

test('点卡片进详情，详情可加入酒柜并回到列表', () => {
  const app = makeApp();
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  assert.equal(app._env.win.location.hash, '#/drink/tcdb-11000');
  app.onHashChange();
  assert.equal(app.state.route.page, 'drink');
  let html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('莫吉托'));
  assert.ok(html.includes('data-act="toggle"'));

  click(app._env.doc, { 'data-act': 'toggle', 'data-id': 'tcdb-11000' });
  assert.deepEqual(app._store.getCabinet(), ['tcdb-11000']);
  html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('已在酒柜'), '详情按钮应切换状态');

  click(app._env.doc, { 'data-act': 'back' });
  assert.equal(app._env.win.__backCalls, 1);
});

test('酒柜页：空状态有引导，加入后列表出现', () => {
  const app = makeApp();
  go(app, '#/cabinet');
  let html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('酒柜还空着'));
  assert.ok(html.includes('去逛逛'));
  assert.ok(html.includes('data-act="gotoRecommend"'));
  assert.equal(app._env.doc.getElementById('pageTitle').textContent, '酒柜');

  app._store.addCabinet('cn-001');
  app.render();
  html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('雪碧伏特加（Sprite Vodka）'));
  assert.ok(html.includes('我的酒柜（1 瓶）'));

  // 空状态按钮能跳回推荐页
  go(app, '#/cabinet');
  click(app._env.doc, { 'data-act': 'gotoRecommend' });
  assert.equal(app._env.win.location.hash, '#/recommend');
});

test('酒柜数据在重新创建 app（模拟刷新）后仍在', () => {
  const env1 = makeEnv();
  const mem = RJStore.memoryStorage();
  const store1 = RJStore.createStore(mem);
  const app1 = RJApp.createApp({ doc: env1.doc, win: env1.win, store: store1, core: Core, ui: UI, tags: Tags });
  app1.start();
  store1.addCabinet('tcdb-11000');
  store1.addCabinet('cn-001');

  const env2 = makeEnv();
  const app2 = RJApp.createApp({ doc: env2.doc, win: env2.win, store: RJStore.createStore(mem), core: Core, ui: UI, tags: Tags });
  app2.start();
  env2.win.location.hash = '#/cabinet';
  app2.onHashChange();
  const html = env2.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('莫吉托'));
  assert.ok(html.includes('雪碧伏特加'));
  assert.ok(html.includes('我的酒柜（2 瓶）'));
});

/* ========== P5：新增配方 ========== */

test('设置 → 新增配方 → 校验 → 保存进推荐页', () => {
  const app = makeApp();
  app.handleAction('settings', null);
  assert.equal(app.state.overlay, 'settings');
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('新增配方'));

  app.handleAction('newRecipe', null);
  assert.equal(app.state.overlay, 'newRecipe');
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('fName'));

  // 空名称报错
  let r = app.saveRecipe();
  assert.equal(r.ok, false);
  assert.match(r.error, /名称/);

  // 有名称无配料报错
  app._env.doc.getElementById('fName').value = '融酒特调';
  r = app.saveRecipe();
  assert.equal(r.ok, false);
  assert.match(r.error, /配料/);

  // 正常保存
  app._env.doc.getElementById('fIng').value = '45毫升伏特加\n15毫升柠檬汁\n';
  app._env.doc.getElementById('fCategory').value = '自制';
  app._env.doc.getElementById('fStep').value = '摇匀。';
  r = app.saveRecipe();
  assert.equal(r.ok, true);
  assert.match(r.record.id, /^my-/);
  assert.equal(app.state.overlay, null);
  assert.equal(app._store.getCustom().length, 1);
  assert.equal(app._store.allRecipes().length, DRINKS.length + 1);

  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('融酒特调'), '新配方应立刻出现在推荐页');
  assert.ok(html.includes('自制'));
});

test('自制配方详情可删除（先弹应用内确认层）', () => {
  const app = makeApp();
  const rec = app._store.addCustom({ name_zh: '临时酒', ingredients_zh: ['水'] });
  go(app, '#/drink/' + rec.id);
  assert.ok(app._env.doc.getElementById('view').innerHTML.includes('data-act="delCustom"'));

  // 点删除只弹确认层，不直接删
  app.handleAction('delCustom', { getAttribute: () => rec.id });
  assert.equal(app.state.overlay, 'confirm');
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('data-act="confirmYes"'));
  assert.equal(app._store.getCustom().length, 1, '确认前不应删除');

  // 确认后才删
  app.handleAction('confirmYes', null);
  assert.equal(app._store.getCustom().length, 0);
  assert.equal(app.state.overlay, null);
});

test('应用内确认层可以取消，取消则不执行', () => {
  const app = makeApp();
  const rec = app._store.addCustom({ name_zh: '临时酒', ingredients_zh: ['水'] });
  go(app, '#/drink/' + rec.id);
  app.handleAction('delCustom', { getAttribute: () => rec.id });
  app.handleAction('confirmNo', null);
  assert.equal(app.state.overlay, null);
  assert.equal(app._store.getCustom().length, 1, '取消后配方还在');
});

/* ========== P7：盲盒 ========== */

test('盲盒默认不限档位（不选=不限），展示可选口感', () => {
  const app = makeApp();
  go(app, '#/box');
  assert.equal(app._env.doc.getElementById('pageTitle').textContent, '盲盒');
  assert.equal(app.state.blind.tierIds.length, 0);
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('价格档位'));
  assert.ok(html.includes('可自定义'));
  assert.ok(html.includes('不选=不限'), '提示语要说明「不选=不限」');
  assert.ok(html.includes('符合条件：' + DRINKS.length + ' 款'));
  for (const t of Tags.ALL_TASTE_TAGS) assert.ok(html.includes(t), '缺口感 ' + t);
});

test('盲盒抽一瓶并支持再来一次（结果不同）', () => {
  const app = makeApp();
  go(app, '#/box');
  const r1 = app.blindDraw();
  assert.equal(r1.ok, true);
  assert.ok(app.state.blind.result);
  let html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('box-result'));
  assert.ok(html.includes('再来一次'));

  const firstId = app.state.blind.result.id;
  let secondId = firstId;
  for (let i = 0; i < 3; i++) {   // 单瓶池也可能回退，多试几次确认排除逻辑生效
    const r2 = app.blindDraw();
    assert.equal(r2.ok, true);
    if (r2.result.id !== firstId) { secondId = r2.result.id; break; }
  }
  const poolLen = app.state.pool.length;
  if (poolLen > 1) assert.notEqual(secondId, firstId, '再来一次应排除上一个结果');
});

test('盲盒点选档位收窄池子，全部取消后回到不限', () => {
  const app = makeApp();
  go(app, '#/box');
  const full = app.state.pool.length;
  assert.equal(full, DRINKS.length);

  // 点一下「30元内」：只剩这一档（以前是「取消」它，与提示相反）
  const ids = Tags.normalizeTiers(app._store.getPriceTiers()).map((t) => t.id);
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[0] });
  assert.deepEqual(app.state.blind.tierIds, [ids[0]]);
  const one = app.state.pool.length;
  assert.ok(one < full, '只选一档应该比不限少');

  // 再点一档：并集，池子不会更小
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[1] });
  assert.equal(app.state.blind.tierIds.length, 2);
  assert.ok(app.state.pool.length >= one);
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('符合条件：' + app.state.pool.length + ' 款'));

  // 全部取消 = 不限
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[0] });
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[1] });
  assert.equal(app.state.blind.tierIds.length, 0);
  assert.equal(app.state.pool.length, full);

  // 选一个口感
  click(app._env.doc, { 'data-act': 'taste', 'data-val': '甜' });
  assert.deepEqual(app.state.blind.tastes, ['甜']);
  for (const d of app.state.pool) {
    assert.ok(Tags.deriveTastes(d).includes('甜'));
  }
});

test('盲盒结果可直接加入酒柜', () => {
  const app = makeApp();
  go(app, '#/box');
  const r = app.blindDraw();
  const id = r.result.id;
  click(app._env.doc, { 'data-act': 'toggle', 'data-id': id });
  assert.ok(app._store.isInCabinet(id));
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('已在酒柜'));
});

test('盲盒条件无匹配时给出提示且按钮禁用', () => {
  // 造一个永远匹配不到任何酒的档位（价格区间远高于估算价）
  const app = makeApp({ tiers: [{ label: '天价档', min: 200000, max: 300000 }] });
  go(app, '#/box');
  const ids = Tags.normalizeTiers(app._store.getPriceTiers()).map((t) => t.id);
  click(app._env.doc, { 'data-act': 'tier', 'data-val': ids[0] });
  assert.equal(app.state.pool.length, 0);
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('放宽'));
  assert.ok(html.includes('disabled'));
  const r = app.blindDraw();
  assert.equal(r.ok, false);
  assert.equal(app.state.blind.result, null);
});

test('盲盒自定义档位（用户改过的）生效', () => {
  const app = makeApp({ tiers: [
    { label: '超便宜', min: 0, max: 20 },
    { label: '土豪', min: 20, max: 99999 }
  ] });
  go(app, '#/box');
  assert.equal(app.state.blind.tierIds.length, 0);
  const html = app._env.doc.getElementById('view').innerHTML;
  assert.ok(html.includes('超便宜'));
  assert.ok(html.includes('土豪'));
  assert.ok(!html.includes('30元内'), '默认档位应被自定义档位替换');
  for (const d of app.state.pool) {
    assert.ok(Tags.estimatePrice(d) < 99999);
  }
});

/* ========== P8：设置 / 备份 / 档位 / 关于 ========== */

test('设置菜单全部入口可打开对应弹层', () => {
  const app = makeApp();
  app.handleAction('settings', null);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('导出备份'));

  app.handleAction('about', null);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('关于'));
  assert.ok(!app._env.doc.getElementById('overlay').innerHTML.includes('来源'));

  app.handleAction('import', null);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('importMerge'));

  app.handleAction('tiers', null);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('data-tier-label'));

  app.handleAction('closeOverlay', null);
  assert.equal(app.state.overlay, null);
  assert.equal(app._env.doc.getElementById('overlay').className, 'overlay hidden');
});

test('导出备份生成合法 JSON', () => {
  const app = makeApp();
  app._store.addCabinet('tcdb-11000');
  const r = app.exportBackup();
  assert.equal(r.ok, true);
  assert.match(r.name, /^融酒备份-\d{4}-\d{2}-\d{2}\.json$/);
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.app, 'rongjiu');
  assert.deepEqual(parsed.cabinet, ['tcdb-11000']);
});

test('导入：合并与覆盖均生效，非法文件报错不破坏数据', () => {
  const a = makeApp();
  a._store.addCabinet('tcdb-11000');
  const backup = JSON.stringify(a._store.exportBackup());

  const b = makeApp();
  b._store.addCabinet('cn-001');
  go(b, '#/cabinet');

  let r = b.applyImport(backup, 'merge');
  assert.equal(r.ok, true);
  assert.equal(b._store.getCabinet().length, 2);

  r = b.applyImport('这是垃圾', 'merge');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
  assert.equal(b._store.getCabinet().length, 2, '失败不应影响现有数据');
  assert.ok(b._env.doc.getElementById('view').innerHTML.includes('雪碧伏特加'), '页面仍在酒柜');

  r = b.applyImport(backup, 'replace');
  assert.equal(r.ok, true);
  assert.deepEqual(b._store.getCabinet(), ['tcdb-11000']);
});

test('价格档位编辑：增删改校验并保存', () => {
  const app = makeApp();
  app.handleAction('tiers', null);
  assert.equal(app.state.tierDraft.length, 3);

  // 加一档
  app.handleAction('addTier', null);
  assert.equal(app.state.tierDraft.length, 4);

  // 填写并通过输入事件同步
  const inputs = [
    ['data-tier-label', '0', '特便宜'],
    ['data-tier-min', '0', '0'],
    ['data-tier-max', '0', '10'],
    ['data-tier-label', '1', '中档'],
    ['data-tier-min', '1', '10'],
    ['data-tier-max', '1', '50'],
    ['data-tier-label', '2', '高档'],
    ['data-tier-min', '2', '50'],
    ['data-tier-max', '2', '100'],
    ['data-tier-label', '3', '顶级'],
    ['data-tier-min', '3', '100'],
    ['data-tier-max', '3', '']
  ];
  inputs.forEach(([attr, idx, val]) => {
    const el = new El('input', app._env.doc);
    el.setAttribute(attr, idx);
    el.value = val;
    app._env.doc.dispatch('input', { target: el });
  });

  const r = app.saveTiers();
  assert.equal(r.ok, true);
  const saved = app._store.getPriceTiers();
  assert.equal(saved.length, 4);
  assert.equal(saved[0].label, '特便宜');
  assert.equal(saved[3].max, null, '留空经 JSON 序列化存为 null（Infinity 不可序列化）');
  assert.equal(app.tiers()[3].max, Infinity, '读取时还原为不限');
  assert.ok(Tags.tierOf(99999, app.tiers()), '99999 元仍落在顶级档');

  // 档位变化后盲盒立即使用新档位，且选中状态回到「不限」（旧 id 已失效）
  go(app, '#/box');
  assert.equal(app.state.blind.tierIds.length, 0);
  assert.ok(app._env.doc.getElementById('view').innerHTML.includes('特便宜'));
});

test('价格档位校验：max<=min 与空档位被拒绝', () => {
  const app = makeApp();
  app.handleAction('tiers', null);
  app.state.tierDraft = [{ label: '坏档', min: 50, max: 10 }];
  let r = app.saveTiers();
  assert.equal(r.ok, false);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('必须大于最低价'));
  assert.equal(app._store.getPriceTiers(), null, '校验失败不写入');

  app.state.tierDraft = [{ label: '   ', min: 0, max: 10 }];
  r = app.saveTiers();
  assert.equal(r.ok, false);
  assert.ok(app._env.doc.getElementById('overlay').innerHTML.includes('没填名称'), '空档位应提示而不是静默丢弃');
});

test('恢复默认档位', () => {
  const app = makeApp({ tiers: [{ label: '仅一档', min: 0, max: 99999 }] });
  app.handleAction('tiers', null);
  assert.equal(app.state.tierDraft.length, 1);
  app.handleAction('resetTiers', null);
  assert.equal(app.state.tierDraft.length, 3);
  assert.equal(app.state.tierDraft[0].label, '30元内');
  const r = app.saveTiers();
  assert.equal(r.ok, true);
  assert.equal(app._store.getPriceTiers().length, 3);
});

test('价格档位弹层可以取消退出，不用非得保存', () => {
  const app = makeApp();
  app.handleAction('tiers', null);
  const html = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(html.includes('data-act="closeOverlay"'), '档位弹层应有取消按钮');
  assert.ok(html.includes('取消'));

  click(app._env.doc, { 'data-act': 'closeOverlay' });
  assert.equal(app.state.overlay, null);
  assert.equal(app._env.doc.getElementById('overlay').className, 'overlay hidden');
});

test('点遮罩空白处关闭弹层，点弹层内部不关', () => {
  const app = makeApp();
  const ov = app._env.doc.getElementById('overlay');

  app.handleAction('tiers', null);
  assert.equal(app.state.overlay, 'tiers');

  // 点在弹层内部（target 不是遮罩本身）：不关闭
  ov.dispatch('click', { target: new El('div', app._env.doc) });
  assert.equal(app.state.overlay, 'tiers');

  // 点在遮罩空白处：关闭
  ov.dispatch('click', { target: ov });
  assert.equal(app.state.overlay, null);
  assert.equal(ov.className, 'overlay hidden');
});

test('清空全部数据后酒柜与自制均为空', () => {
  const app = makeApp();
  app._store.addCabinet('tcdb-11000');
  app._store.addCustom({ name_zh: 'x', ingredients_zh: ['水'] });

  // 先弹应用内确认层，点「确定清空」才真的清
  app.handleAction('clearAll', null);
  assert.equal(app.state.overlay, 'confirm');
  assert.deepEqual(app._store.getCabinet(), ['tcdb-11000'], '确认前不该动数据');
  app.handleAction('confirmYes', null);

  assert.deepEqual(app._store.getCabinet(), []);
  assert.deepEqual(app._store.getCustom(), []);
  go(app, '#/cabinet');
  assert.ok(app._env.doc.getElementById('view').innerHTML.includes('酒柜还空着'));
});

test('非法路由回落推荐页', () => {
  const app = makeApp();
  go(app, '#/whatever');
  assert.equal(app.state.route.page, 'recommend');
  go(app, '#/drink/not-exist-id');
  assert.ok(app._env.doc.getElementById('view').innerHTML.includes('找不到这个配方'));
});
