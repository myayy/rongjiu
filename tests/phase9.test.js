'use strict';

/* P9：兑酒专区 / 我的材料 → 能做的酒 / 星级评价 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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
  const store = RJStore.createStore(opts.storage || RJStore.memoryStorage());
  const app = RJApp.createApp({
    doc: env.doc, win: env.win, store, core: Core, ui: UI, tags: Tags,
    seed: opts.seed, random: opts.random
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

/* ========== 兑酒专区 ========== */

test('兑酒页：路由、标题、tab 高亮、渲染出 cn 配方', () => {
  assert.equal(Core.parseHash('#/mixer').page, 'mixer');
  const app = makeApp({ seed: 111 });
  go(app, '#/mixer');
  assert.equal(app.state.route.page, 'mixer');
  assert.equal(app._env.doc.getElementById('pageTitle').textContent, '兑酒');

  const cnCount = DRINKS.filter((d) => d.id.indexOf('cn-') === 0).length;
  assert.equal(cnCount, 36, '应有 36 条兑酒配方');
  const ids = cardIds(app);
  assert.equal(ids.length, cnCount);
  assert.ok(ids.every((id) => id.indexOf('cn-') === 0), '兑酒页只列 cn 配方');
  assert.ok(viewHtml(app).includes('中国饮料 × 酒'));

  const tabs = app._env.doc.querySelectorAll('.tab');
  const mixerTab = tabs.filter((t) => t.getAttribute('data-tab') === 'mixer')[0];
  assert.ok(mixerTab, '应存在 mixer tab');
  assert.equal(mixerTab.className, 'tab active');
});

test('兑酒页配方可进详情、可加入酒柜', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/mixer');
  const id = cardIds(app)[0];
  click(app._env.doc, { 'data-act': 'open', 'data-id': id });
  app.onHashChange();
  assert.equal(app.state.route.page, 'drink');
  assert.ok(viewHtml(app).includes('data-act="toggle"'), '详情页应能加入酒柜');
  click(app._env.doc, { 'data-act': 'toggle', 'data-id': id });
  assert.deepEqual(app._store.getCabinet(), [id]);
});

test('切到兑酒页再回推荐页：不恢复旧滚动位置（不干扰详情返回）', () => {
  const app = makeApp({ seed: 111 });
  const v = app._env.doc.getElementById('view');
  v.clientHeight = 600; v.scrollHeight = 3000; v.scrollTop = 2600;
  v.dispatch('scroll', {});
  assert.equal(app.state.shown, 60);
  v.scrollTop = 4200;

  go(app, '#/mixer');
  assert.equal(app.state.shown, 30, '切页应复位列表');
  go(app, '#/recommend');
  assert.equal(app.state.shown, 30);
  assert.equal(v.scrollTop, 0, '回推荐页应从顶部开始');
});

test('进详情再返回仍然恢复滚动位置（兑酒 tab 不影响）', () => {
  const app = makeApp({ seed: 111 });
  const v = app._env.doc.getElementById('view');
  v.clientHeight = 600; v.scrollHeight = 3000; v.scrollTop = 2600;
  v.dispatch('scroll', {});
  v.scrollTop = 4200;
  const backTo = app._env.win.location.hash;
  click(app._env.doc, { 'data-act': 'open', 'data-id': DRINKS[0].id });
  app.onHashChange();
  go(app, backTo);
  assert.equal(app.state.shown, 60);
  assert.equal(v.scrollTop, 4200);
});

/* ========== 我的材料 → 能做的酒 ========== */

test('pantryMissing：双向包含、冰水不算缺、只有冰水的配方不参与', () => {
  const sample = { id: 'x', ingredients_zh: ['白朗姆酒（45 毫升）', '可乐（加至满杯）', '冰块（根据个人口味）'] };
  assert.deepEqual(Tags.pantryMissing(sample, ['朗姆酒', '可乐']), [], '朗姆酒应命中白朗姆酒', '冰不算缺');
  assert.deepEqual(Tags.pantryMissing(sample, ['白朗姆酒']), ['可乐'], '反方向也应命中');
  assert.deepEqual(Tags.pantryMissing(sample, []), ['白朗姆酒', '可乐']);

  const onlyWater = { id: 'y', ingredients_zh: ['冰块（根据个人口味）', '水（根据个人口味）'] };
  assert.equal(Tags.pantryMissing(onlyWater, []), null, '全是冰水的配方不参与');
});

test('pantryGroups：ready 全齐全，near 全差 1 样', () => {
  const pantry = ['朗姆酒', '青柠汁', '糖', '薄荷'];
  const g = Tags.pantryGroups(DRINKS, pantry);
  assert.ok(g.ready.length > 0, '应能找到材料齐全的酒');
  assert.ok(g.ready.every((x) => x.missing === null));
  assert.ok(g.near.length > 0, '应能找到还差 1 样的酒');
  assert.ok(g.near.every((x) => typeof x.missing === 'string' && x.missing));
  assert.ok(g.ready.every((x) => x.drink && x.drink.id));
});

test('酒柜页：录入材料 → 分「材料齐全 / 还差 1 样」两组；删除后更新', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  let html = viewHtml(app);
  assert.ok(html.includes('我的材料'), '应有材料面板');
  assert.ok(html.includes('id="pantryInput"'));
  assert.ok(!html.includes('<h3>能做的酒</h3>'), '没录入材料时不显示「能做的酒」');

  const input = app._env.doc.getElementById('pantryInput');
  input.setAttribute('data-pantry-input', '1');
  input.value = '朗姆酒';
  app._env.doc.dispatch('input', { target: input });
  assert.equal(app.state.pantryDraft, '朗姆酒', '打字阶段只记草稿');
  assert.ok(!viewHtml(app).includes('data-act="delPantry"'), '打字阶段不重渲染');

  click(app._env.doc, { 'data-act': 'addPantry' });
  assert.deepEqual(app._store.getPantry(), ['朗姆酒']);
  html = viewHtml(app);
  assert.ok(html.includes('data-act="delPantry"'), '出现材料胶囊');
  assert.ok(viewHtml(app).includes('<h3>能做的酒</h3>'));
  assert.ok(html.includes('材料齐全') || html.includes('还差 1 样'));

  click(app._env.doc, { 'data-act': 'delPantry', 'data-val': '朗姆酒' });
  assert.deepEqual(app._store.getPantry(), []);
  assert.ok(!viewHtml(app).includes('<h3>能做的酒</h3>'));
});

test('录入材料会归一化（30毫升朗姆酒 → 朗姆酒），回车也能提交', () => {
  const app = makeApp({ seed: 111 });
  go(app, '#/cabinet');
  const input = app._env.doc.getElementById('pantryInput');
  input.setAttribute('data-pantry-input', '1');
  input.value = '30毫升朗姆酒';
  app._env.doc.dispatch('input', { target: input });
  app._env.doc.dispatch('keydown', { target: input, key: 'Enter' });
  assert.deepEqual(app._store.getPantry(), ['朗姆酒']);
  assert.equal(app.state.pantryDraft, '', '提交后清空草稿');
});

test('材料持久化：重新创建 app（模拟刷新）后仍在', () => {
  const mem = RJStore.memoryStorage();
  const app1 = makeApp({ seed: 111, storage: mem });
  go(app1, '#/cabinet');
  const input = app1._env.doc.getElementById('pantryInput');
  input.setAttribute('data-pantry-input', '1');
  input.value = '可乐';
  app1._env.doc.dispatch('input', { target: input });
  click(app1._env.doc, { 'data-act': 'addPantry' });

  const app2 = makeApp({ seed: 222, storage: mem });
  go(app2, '#/cabinet');
  assert.deepEqual(app2._store.getPantry(), ['可乐']);
  assert.ok(viewHtml(app2).includes('data-val="可乐"'));
});

/* ========== 星级评价 ========== */

test('星级：setRating 校验、取消、脏数据清洗', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  assert.equal(s.setRating('a', 4), 4);
  assert.equal(s.getRating('a'), 4);
  assert.equal(s.setRating('a', 0), 0, '0 = 取消');
  assert.equal(s.getRating('a'), 0);
  assert.throws(() => s.setRating('a', 6), /评分必须是 1~5/);
  assert.throws(() => s.setRating('a', 401), /评分必须是 1~5/);
  assert.throws(() => s.setRating('a', 'abc'), /评分必须是 1~5/);
  assert.throws(() => s.setRating('', 3), /非法 id/);
  assert.equal(s.setRating('b', '3'), 3, '数字字符串可收');

  s._storage.setItem(RJStore.KEYS.ratings, JSON.stringify({
    ok: 5, big: 401, bad: 'abc', zero: 0, frac: 2.5
  }));
  assert.deepEqual(s.getRatings(), { ok: 5 }, '脏值应被丢弃');
  s._storage.setItem(RJStore.KEYS.ratings, JSON.stringify([1, 2, 3]));
  assert.deepEqual(s.getRatings(), {}, '非对象应回退为 {}');
});

test('详情页点星 → 4 星；再点同一星 → 取消；记得住', () => {
  const mem = RJStore.memoryStorage();
  const app = makeApp({ seed: 111, storage: mem });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  app.onHashChange();
  assert.ok(viewHtml(app).includes('我的评价'));
  assert.ok(viewHtml(app).includes('未评价'));

  click(app._env.doc, { 'data-act': 'rate', 'data-id': 'tcdb-11000', 'data-val': '4' });
  assert.equal(app._store.getRating('tcdb-11000'), 4);
  assert.ok(viewHtml(app).includes('已喝过 ★4'));

  click(app._env.doc, { 'data-act': 'rate', 'data-id': 'tcdb-11000', 'data-val': '4' });
  assert.equal(app._store.getRating('tcdb-11000'), 0, '再点同一星应取消');
  assert.ok(viewHtml(app).includes('未评价'));

  // 重新创建 app 后仍在（持久化）
  click(app._env.doc, { 'data-act': 'rate', 'data-id': 'tcdb-11000', 'data-val': '5' });
  const app2 = makeApp({ seed: 222, storage: mem });
  assert.equal(app2._store.getRating('tcdb-11000'), 5);
  go(app2, '#/drink/tcdb-11000');
  assert.ok(viewHtml(app2).includes('已喝过 ★5'));
});

test('推荐页卡片显示「已喝过 ★N」', () => {
  const app = makeApp({ seed: 111 });
  const first = cardIds(app)[0];
  assert.ok(first, '应有卡片');
  assert.ok(!viewHtml(app).includes('已喝过'), '没评过分就不显示标签');
  app._store.setRating(first, 5);
  app.render();
  assert.ok(viewHtml(app).includes('已喝过 ★5'));
});

test('酒柜页「喝过的酒」按星级降序', () => {
  const app = makeApp({ seed: 111 });
  app._store.setRating('tcdb-11000', 3);
  app._store.setRating('od-zombie', 5);
  go(app, '#/cabinet');
  const html = viewHtml(app);
  assert.ok(html.includes('喝过的酒（2）'));
  assert.ok(html.indexOf('僵尸') < html.indexOf('莫吉托'), '5 星应排在 3 星前面');
  assert.ok(html.includes('data-act="rate"'));
});

test('备份往返带上材料与评分', () => {
  const a = RJStore.createStore(RJStore.memoryStorage());
  a.addPantry('朗姆酒');
  a.addPantry('可乐');
  a.setRating('tcdb-11000', 4);

  const b = RJStore.createStore(RJStore.memoryStorage());
  b.importBackup(JSON.stringify(a.exportBackup()), 'replace');
  assert.deepEqual(b.getPantry(), ['朗姆酒', '可乐']);
  assert.deepEqual(b.getRatings(), { 'tcdb-11000': 4 });

  // merge 不重复
  b.importBackup(JSON.stringify(a.exportBackup()), 'merge');
  assert.deepEqual(b.getPantry(), ['朗姆酒', '可乐']);
  assert.deepEqual(b.getRatings(), { 'tcdb-11000': 4 });
});

test('旧备份（无 pantry / ratings 字段）仍能导入', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.importBackup(JSON.stringify({ app: 'rongjiu', schema: 1, cabinet: [], custom: [] }), 'merge');
  assert.deepEqual(s.getPantry(), []);
  assert.deepEqual(s.getRatings(), {});
});

/* ========== 数据文案 ========== */

test('配料里不再出现「适量」', () => {
  const zh = fs.readFileSync(path.join(ROOT, '素材', 'index.zh.json'), 'utf8').replace(/^\uFEFF/, '');
  assert.equal(zh.indexOf('适量'), -1, 'index.zh.json 里不应再有「适量」');
  for (const d of DRINKS) {
    for (const line of d.ingredients_zh) {
      assert.ok(line.indexOf('适量') === -1, `${d.id} 仍有「适量」: ${line}`);
    }
  }
});

test('兑酒配方格式完整（有中文名、配料、做法）', () => {
  const cn = DRINKS.filter((d) => d.id.indexOf('cn-') === 0);
  assert.equal(cn.length, 36);
  for (const d of cn) {
    assert.match(d.name_display, /（.+）/, `${d.id} 展示名格式`);
    assert.equal(d.category, '饮料兑酒');
    assert.ok(d.ingredients_zh.length >= 2, `${d.id} 配料太少`);
    assert.ok(d.instructions_zh.length > 5, `${d.id} 缺做法`);
  }
});
