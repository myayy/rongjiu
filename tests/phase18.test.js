/* P18：能做的酒 —— 缺料档位筛选（还差 0 / 1 / 2 / 3 样）、全量显示，
   以及主按钮从「金色实底」换成「水晶玻璃 + 发光折射边」。

   背景：以前只列「材料齐全」和「还差 1 样」。用户只录了一样材料时，
   「养乐多伏特加」（伏特加 + 养乐多 + 苏打水）这种差 2 样的酒根本看不到，
   必须再补录一样材料才会冒出来 —— 现在把档位开到 3，由用户自己决定看多远。 */

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

function cabListHtml(app) {
  return app._env.doc.getElementById('cabList').innerHTML;
}

/* ---------- ① 缺料档位分桶 ---------- */

test('pantryBuckets：摊出 0~3 四档，冰水不算缺', () => {
  const b = Tags.pantryBuckets(DRINKS, ['苏打水'], 3);
  assert.deepEqual(b.map((x) => x.miss), [0, 1, 2, 3], '档位应是 0/1/2/3');
  assert.ok(b.every((x) => Array.isArray(x.items)));
  // 每档都不能有跨档的脏数据
  assert.ok(b[0].items.every((x) => x.missing === null), '齐全档的 missing 必须是 null');
  assert.ok(b[1].items.every((x) => typeof x.missing === 'string' && x.missing));
});

test('pantryBuckets：只录「苏打水」，「养乐多伏特加」落在「还差 2 样」档', () => {
  const b = Tags.pantryBuckets(DRINKS, ['苏打水'], 3);
  const hit = b[2].items.find((x) => x.drink.id === 'cn-006');
  assert.ok(hit, '差 2 样档里应该能看到养乐多伏特加（伏特加 + 养乐多 + 苏打水）');
  assert.equal(hit.missing, '2 样 · 伏特加、养乐多', '把还缺的写清楚，实际：' + hit.missing);
  // 差 1 档不该有它，否则分组就串了
  assert.ok(!b[1].items.some((x) => x.drink.id === 'cn-006'));
  assert.ok(!b[0].items.some((x) => x.drink.id === 'cn-006'));
});

test('pantryBuckets：再补「养乐多」就升到「还差 1 样」', () => {
  const b = Tags.pantryBuckets(DRINKS, ['苏打水', '养乐多'], 3);
  const hit = b[1].items.find((x) => x.drink.id === 'cn-006');
  assert.ok(hit, '补一样材料后就该只差伏特加了');
  assert.equal(hit.missing, '伏特加');
});

test('pantryBuckets：差 2 样以上同样要求配方里有一样是我手上的', () => {
  const only = [{ id: 'z', name_display: '纯威士忌一口饮', ingredients_zh: ['威士忌（45 毫升）', '苦精（2 毫升）'] }];
  const b = Tags.pantryBuckets(only, ['冰红茶'], 3);
  assert.equal(b[1].items.length, 0);
  assert.equal(b[2].items.length, 0, '跟冰红茶毫不相干，差 2 样也不该推');
});

test('pantryBuckets：超过 maxMiss 的配方直接不出现', () => {
  const d = { id: 'q', ingredients_zh: ['伏特加（30 毫升）', '养乐多（100 毫升）', '苏打水（60 毫升）'] };
  const b = Tags.pantryBuckets([d], ['苏打水'], 1);
  assert.equal(b.length, 2, 'maxMiss=1 时只有齐全 + 差 1 两档');
  assert.ok(!b.some((x) => x.items.some((y) => y.drink.id === 'q')));
});

/* ---------- ② 筛选条与全量显示 ---------- */

test('能做 Tab：带缺料档位筛选条，点的动作用 missLevel 承载', () => {
  const buckets = [
    { miss: 0, items: [{ drink: DRINKS[0], missing: null }] },
    { miss: 1, items: [] },
    { miss: 2, items: [{ drink: DRINKS[1], missing: '2 样 · 伏特加、养乐多' }] },
    { miss: 3, items: [] }
  ];
  const html = UI.makeableHtml([], [], Tags, ['苏打水'], { buckets, depth: [0, 1] });
  assert.ok(html.includes('data-act="missLevel" data-val="0"'), '齐全档');
  assert.ok(html.includes('data-act="missLevel" data-val="2"'), '差 2 样档');
  assert.ok(html.includes('还差 2 样（1）'), '档位上要带数量');
  // 默认只勾了 0、1，差 2 样的酒单先不铺出来
  assert.ok(!html.includes('data-id="' + DRINKS[1].id + '"'), '未勾选的档位不该出现');
  // 打开差 2 样后出现
  const on = UI.makeableHtml([], [], Tags, ['苏打水'], { buckets, depth: [0, 1, 2] });
  assert.ok(on.includes('data-id="' + DRINKS[1].id + '"'));
});

test('能做 Tab：候选全列出来，不再截前 20 款', () => {
  const many = [];
  for (let i = 0; i < 26; i++) {
    many.push({
      drink: { id: 'd' + i, name_display: '测试酒' + i, ingredients_zh: ['朗姆酒（30 毫升）'] },
      missing: null
    });
  }
  const html = UI.makeableHtml(many, [], Tags, ['朗姆酒']);
  assert.equal((html.match(/class="card"/g) || []).length, 26, '26 款要全部渲染出来');
  assert.ok(!html.includes('仅显示前'), '不该再有截断提示');
});

/* ---------- ③ 交互：点档位真的会变 ---------- */

test('能做 Tab：点「还差 2 样」把差 2 样的酒铺出来，再点一次收回去', () => {
  const app = makeApp({ seed: 21 });
  go(app, '#/cabinet');
  app._store.addPantry('苏打水');

  app.handleAction('cabTab', { getAttribute: () => 'makeable' });
  let html = cabListHtml(app);
  assert.ok(html.includes('data-act="missLevel"'), '要有档位筛选条');
  assert.ok(!html.includes('data-id="cn-006"'), '默认不看差 2 样的酒');

  click(app._env.doc, { 'data-act': 'missLevel', 'data-val': '2' });
  assert.deepEqual(app.state.missDepth, [0, 1, 2], '档位应被勾上');
  html = cabListHtml(app);
  assert.ok(html.includes('data-id="cn-006"'), '勾上后应看到养乐多伏特加');
  assert.ok(html.includes('2 样 · 伏特加、养乐多'), '卡片上要写清还缺什么');

  click(app._env.doc, { 'data-act': 'missLevel', 'data-val': '2' });
  assert.deepEqual(app.state.missDepth, [0, 1], '再点一次收回');
  assert.ok(!cabListHtml(app).includes('data-id="cn-006"'));
});

test('能做 Tab：档位至少留一个，全关掉会自动保住「材料齐全」', () => {
  const app = makeApp({ seed: 22 });
  go(app, '#/cabinet');
  app._store.addPantry('朗姆酒');
  app.handleAction('cabTab', { getAttribute: () => 'makeable' });

  click(app._env.doc, { 'data-act': 'missLevel', 'data-val': '1' });
  assert.deepEqual(app.state.missDepth, [0]);
  click(app._env.doc, { 'data-act': 'missLevel', 'data-val': '0' });
  assert.deepEqual(app.state.missDepth, [0], '不能一个档位都不留');
  assert.ok(cabListHtml(app).includes('能做的酒'));
});

/* ---------- ④ 主按钮：不再用金色实底 ---------- */

test('主按钮换成水晶玻璃边框：CSS 里不再有金色实底变量', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  assert.ok(css.includes('--crystal-grad'), '应有水晶玻璃变量');
  assert.ok(css.includes('--crystal-line'), '应有折射亮边变量');
  assert.ok(!/--gold-/.test(css), '金色实底变量应清干净');
  const btn = /\.btn \{[\s\S]*?\n\}/.exec(css);
  assert.ok(btn, '找得到 .btn 规则');
  assert.ok(btn[0].includes('var(--crystal-grad)'), '主按钮用玻璃底');
  assert.ok(btn[0].includes('var(--crystal-line)'), '主按钮边框走水晶亮边');
  assert.ok(/box-shadow:[^;]*var\(--crystal-glow\)/.test(btn[0]), '要有外发光');
});
