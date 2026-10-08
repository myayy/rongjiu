'use strict';

/* P10：浏览历史（足迹） */

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

/* 固定时间点：2026-10-08 21:30（本地时区） */
const T0 = new Date(2026, 9, 8, 21, 30, 0).getTime();

/* ========== 时间格式化 ========== */

test('formatStamp：格式为「xxxx年xx月xx日 xx点xx分」并补零', () => {
  assert.equal(Core.formatStamp(T0), '2026年10月08日 21点30分');
  const t2 = new Date(2026, 0, 5, 9, 7, 0).getTime();     // 2026-01-05 09:07
  assert.equal(Core.formatStamp(t2), '2026年01月05日 09点07分');
  assert.equal(Core.formatStamp('abc'), '');
  assert.equal(Core.formatStamp(null), '');
  assert.equal(Core.formatStamp(undefined), '');
  assert.equal(Core.formatStamp(''), '');
});

/* ========== store 层 ========== */

test('浏览历史：写入、去重、最新在前、时间刷新', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.pushHistory('a', 1000);
  s.pushHistory('b', 2000);
  assert.deepEqual(s.getHistory(), [{ id: 'b', at: 2000 }, { id: 'a', at: 1000 }], '最新在前');

  s.pushHistory('a', 3000);   // 再看一次
  assert.deepEqual(s.getHistory(), [{ id: 'a', at: 3000 }, { id: 'b', at: 2000 }],
    '重复浏览只留一条，时间刷新并挪到最前');
});

test('浏览历史：最多保留 100 条，超出丢最旧', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  for (let i = 0; i < 130; i++) s.pushHistory('d' + i, 1000 + i);
  const list = s.getHistory();
  assert.equal(list.length, 100);
  assert.equal(list[0].id, 'd129', '最新的在最前');
  assert.equal(list[99].id, 'd30', '最旧的 30 条被丢掉');
});

test('浏览历史：脏数据清洗（非数组 / 缺字段 / 非数字时间）', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s._storage.setItem(RJStore.KEYS.history, JSON.stringify('nope'));
  assert.deepEqual(s.getHistory(), []);
  s._storage.setItem(RJStore.KEYS.history, JSON.stringify([
    { id: 'ok', at: 5 }, { id: '', at: 6 }, { at: 7 }, { id: 'bad', at: 'x' }, null
  ]));
  assert.deepEqual(s.getHistory(), [{ id: 'ok', at: 5 }]);
});

test('浏览历史：删除单条与清空', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.pushHistory('a', 1);
  s.pushHistory('b', 2);
  assert.equal(s.removeHistory('a'), true);
  assert.equal(s.removeHistory('zzz'), false);
  assert.deepEqual(s.getHistory(), [{ id: 'b', at: 2 }]);
  s.clearHistory();
  assert.deepEqual(s.getHistory(), []);
});

test('浏览历史：clearAll 一并清空', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.pushHistory('a', 1);
  s.clearAll();
  assert.deepEqual(s.getHistory(), []);
});

/* ========== app 层 ========== */

test('打开详情页会记录浏览历史（含时间）', () => {
  const app = makeApp({ seed: 111, now: () => T0 });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  assert.deepEqual(app._store.getHistory(), [{ id: 'tcdb-11000', at: T0 }]);
  app.onHashChange();
  assert.equal(app.state.route.page, 'drink', '仍正常进详情');
});

test('酒柜页「浏览历史」按时间倒序，显示年月日时分', () => {
  let t = T0;
  const app = makeApp({ seed: 111, now: () => (t += 60000) });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'cn-001' });
  go(app, '#/history');
  const html = viewHtml(app);
  assert.ok(html.includes('浏览历史（2）'));
  assert.ok(html.includes('data-act="clearHistory"'));
  assert.ok(/hist-time">\d{4}年\d{2}月\d{2}日 \d{2}点\d{2}分</.test(html), '应有「xxxx年xx月xx日 xx点xx分」');
  assert.ok(html.indexOf('雪碧伏特加') < html.indexOf('莫吉托'), '后看的应排在前');
});

test('删除单条历史 与 清空历史', () => {
  const app = makeApp({ seed: 111, now: () => T0 });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });
  click(app._env.doc, { 'data-act': 'open', 'data-id': 'cn-001' });
  go(app, '#/history');

  click(app._env.doc, { 'data-act': 'delHistory', 'data-val': 'tcdb-11000' });
  assert.deepEqual(app._store.getHistory().map((x) => x.id), ['cn-001']);
  assert.ok(viewHtml(app).includes('浏览历史（1）'));

  click(app._env.doc, { 'data-act': 'clearHistory' });
  assert.equal(app.state.overlay, 'confirm', '清空历史要先弹应用内确认层');
  assert.deepEqual(app._store.getHistory().map((x) => x.id), ['cn-001'], '确认前不清');
  click(app._env.doc, { 'data-act': 'confirmYes' });
  assert.deepEqual(app._store.getHistory(), []);
  assert.ok(!viewHtml(app).includes('浏览历史'), '清空后整块隐藏');
});

test('浏览历史持久化：重新创建 app 后仍在', () => {
  const mem = RJStore.memoryStorage();
  const app1 = makeApp({ seed: 111, storage: mem, now: () => T0 });
  click(app1._env.doc, { 'data-act': 'open', 'data-id': 'tcdb-11000' });

  const app2 = makeApp({ seed: 222, storage: mem });
  go(app2, '#/history');
  assert.deepEqual(app2._store.getHistory().map((x) => x.id), ['tcdb-11000']);
  assert.ok(viewHtml(app2).includes('2026年10月08日 21点30分'), '时间文案应还原');
});

test('浏览历史：配方已不存在时该条自动跳过', () => {
  const app = makeApp({ seed: 111, now: () => T0 });
  app._store.pushHistory('已删除的配方', T0);
  app._store.pushHistory('tcdb-11000', T0);
  go(app, '#/history');
  assert.ok(viewHtml(app).includes('浏览历史（1）'), '无效记录不计入');
});

/* ========== 备份往返 ========== */

test('备份往返带上浏览历史（replace 与 merge）', () => {
  const a = RJStore.createStore(RJStore.memoryStorage());
  a.pushHistory('x', 5000);
  a.pushHistory('y', 6000);

  const b = RJStore.createStore(RJStore.memoryStorage());
  b.importBackup(JSON.stringify(a.exportBackup()), 'replace');
  assert.deepEqual(b.getHistory(), [{ id: 'y', at: 6000 }, { id: 'x', at: 5000 }]);

  // merge：同款取时间较新的
  b.pushHistory('x', 7000);
  b.importBackup(JSON.stringify(a.exportBackup()), 'merge');
  const list = b.getHistory();
  assert.equal(list.length, 2, '不应重复');
  assert.equal(list[0].id, 'x');
  assert.equal(list[0].at, 7000, '保留较新的时间');
});

test('旧的（无 history 字段）备份仍能导入', () => {
  const s = RJStore.createStore(RJStore.memoryStorage());
  s.importBackup(JSON.stringify({ app: 'rongjiu', schema: 1, cabinet: [], custom: [] }), 'merge');
  assert.deepEqual(s.getHistory(), []);
});

/* ========== 兑酒配方配图 ========== */

test('兑酒配方都有图片字段，且文件真实存在', () => {
  const cn = DRINKS.filter((d) => d.id.indexOf('cn-') === 0);
  assert.equal(cn.length, 36);
  for (const d of cn) {
    assert.ok(d.image, `${d.id} 缺少 image`);
    assert.ok(fs.existsSync(path.join(ROOT, d.image)), `${d.id} 图片不存在: ${d.image}`);
    assert.ok(fs.statSync(path.join(ROOT, d.image)).size > 5120, `${d.id} 图片过小`);
  }
});
