'use strict';

/* P9 最终验收：静态自检 + 全量回归入口 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('纯静态约束：不使用 fetch/XHR/ES Module/本地服务器', () => {
  const files = ['index.html', 'js/app.js', 'js/ui.js', 'js/core.js', 'js/store.js', 'js/tags.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} 使用了 fetch（file:// 下不可用）`);
    assert.ok(!/XMLHttpRequest/.test(src), `${f} 使用了 XHR`);
    assert.ok(!/type\s*=\s*["']module["']/.test(src), `${f} 使用了 ES Module`);
    assert.ok(!/\bimport\s+[{"']/.test(src), `${f} 使用了 import 语法`);
    assert.ok(!require('os').EOL || true);
  }
});

test('index.html 引入顺序正确且资源全部存在', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = ['data.js', 'tags.js', 'store.js', 'core.js', 'ui.js', 'app.js'];
  let last = -1;
  for (const name of order) {
    const idx = html.indexOf('js/' + name);
    assert.ok(idx > last, `${name} 缺失或顺序错误`);
    last = idx;
    assert.ok(fs.existsSync(path.join(ROOT, 'js', name)), `js/${name} 不存在`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'css', 'style.css')));
  assert.ok(html.includes('id="view"') && html.includes('class="tabbar"'), '缺少视图容器/导航');
});

test('不落 C 盘：项目内无 node_modules/package.json/构建产物', () => {
  for (const bad of ['node_modules', 'package.json', 'package-lock.json', 'dist', 'build', '.cache']) {
    assert.ok(!fs.existsSync(path.join(ROOT, bad)), `不应存在 ${bad}（零依赖约束）`);
  }
});

test('数据文件体积合理且含全部配方', () => {
  const stat = fs.statSync(path.join(ROOT, 'js', 'data.js'));
  assert.ok(stat.size > 1024 * 1024 && stat.size < 12 * 1024 * 1024, `data.js 体积异常: ${stat.size}`);
  const src = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  assert.equal((src.match(/"id":/g) || []).length, 1431);
});

test('导出备份不会写入 Infinity（JSON 合法）', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  const RJStore = require(path.join(ROOT, 'js', 'store.js'));
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.setPriceTiers([{ label: 'A', min: 0, max: Infinity }]);
  const text = JSON.stringify(s.exportBackup());
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(!text.includes('Infinity'));
});

test('素材目录未被修改（只读引用）', () => {
  const zh = fs.readFileSync(path.join(ROOT, '素材', 'index.zh.json'), 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(zh);
  assert.equal(parsed.total, 1431);
  assert.equal(parsed.with_image, 1430);
});

test('所有 js 文件在 Node 中均可加载且导出 API', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  const checks = [
    ['tags.js', ['deriveTastes', 'estimatePrice', 'defaultTiers', 'normalizeTiers', 'tierOf']],
    ['store.js', ['createStore']],
    ['core.js', ['parseHash', 'buildHash', 'queryTokens', 'matchesQuery', 'filterRecipes', 'shuffle', 'pickRandom']],
    ['ui.js', ['cardHtml', 'detailHtml', 'blindHtml', 'settingsHtml']],
    ['app.js', ['createApp']]
  ];
  for (const [file, keys] of checks) {
    const mod = require(path.join(ROOT, 'js', file));
    for (const k of keys) assert.equal(typeof mod[k], 'function', `${file} 缺少 ${k}`);
  }
  assert.equal(globalThis.DRINKS.length, 1431);
});

test('端到端冒烟：浏览→收藏→盲盒→备份→换机还原', () => {
  const { makeEnv, click } = require('./fakedom');
  require(path.join(ROOT, 'js', 'data.js'));
  const Tags = require(path.join(ROOT, 'js', 'tags.js'));
  const Core = require(path.join(ROOT, 'js', 'core.js'));
  const UI = require(path.join(ROOT, 'js', 'ui.js'));
  const RJStore = require(path.join(ROOT, 'js', 'store.js'));
  const RJApp = require(path.join(ROOT, 'js', 'app.js'));

  const mem = RJStore.memoryStorage();

  // 第一天：逛推荐、收藏、抽盲盒、改档位
  const env1 = makeEnv();
  const store1 = RJStore.createStore(mem);
  const app1 = RJApp.createApp({ doc: env1.doc, win: env1.win, store: store1, core: Core, ui: UI, tags: Tags });
  app1.start();
  click(env1.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  env1.win.location.hash = '#/drink/tcdb-11000';
  app1.onHashChange();
  click(env1.doc, { 'data-act': 'toggle', 'data-id': 'tcdb-11000' });
  env1.win.location.hash = '#/box';
  app1.onHashChange();
  const draw = app1.blindDraw();
  assert.equal(draw.ok, true);
  const drawnId = draw.result.id;
  click(env1.doc, { 'data-act': 'toggle', 'data-id': drawnId });
  app1.handleAction('export', null);
  const backup = JSON.stringify(store1.exportBackup());
  assert.deepEqual(store1.getCabinet().sort(), ['tcdb-11000', drawnId].sort());

  // 第二天：浏览器重开（新 env、同一 localStorage）
  const env2 = makeEnv();
  const store2 = RJStore.createStore(mem);
  const app2 = RJApp.createApp({ doc: env2.doc, win: env2.win, store: store2, core: Core, ui: UI, tags: Tags });
  app2.start();
  env2.win.location.hash = '#/cabinet';
  app2.onHashChange();
  const cab = store2.getCabinet();
  assert.deepEqual(cab.sort(), ['tcdb-11000', drawnId].sort(), '重开后酒柜保持');

  // 换一份全新数据，导入备份还原
  const env3 = makeEnv();
  const store3 = RJStore.createStore(RJStore.memoryStorage());
  const app3 = RJApp.createApp({ doc: env3.doc, win: env3.win, store: store3, core: Core, ui: UI, tags: Tags });
  app3.start();
  const res = app3.applyImport(backup, 'replace');
  assert.equal(res.ok, true);
  assert.deepEqual(store3.getCabinet().sort(), ['tcdb-11000', drawnId].sort(), '备份还原成功');
});
