'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const Tags = require(path.join(ROOT, 'js', 'tags.js'));
const Core = require(path.join(ROOT, 'js', 'core.js'));
const UI = require(path.join(ROOT, 'js', 'ui.js'));

const DRINKS = globalThis.DRINKS;
const mojito = DRINKS.find((d) => d.name === 'Mojito');

test('esc 防注入', () => {
  assert.equal(UI.esc('<img src=x onerror=1>"\''), '&lt;img src=x onerror=1&gt;&quot;&#39;');
  assert.equal(UI.esc(null), '');
  assert.equal(UI.esc(undefined), '');
});

test('卡片渲染含名称/图/价格/加入酒柜按钮', () => {
  const html = UI.cardHtml(mojito, { inCabinet: false }, Tags);
  assert.ok(html.includes('莫吉托（Mojito）'));
  assert.ok(html.includes('素材/thecocktaildb/images/11000-Mojito.jpg'));
  assert.ok(html.includes('加载') || html.includes('loading="lazy"'));
  assert.ok(html.includes('data-act="toggle"'));
  assert.ok(html.includes('data-act="open"'));
  assert.ok(html.includes('加入酒柜'));
  assert.ok(!html.includes('已在酒柜'));

  const inHtml = UI.cardHtml(mojito, { inCabinet: true }, Tags);
  assert.ok(inHtml.includes('已在酒柜'));
});

test('自制配方卡片带「自制」标记', () => {
  const custom = { ...mojito, id: 'my-x', source: 'custom', image: '' };
  const html = UI.cardHtml(custom, {}, Tags);
  assert.ok(html.includes('自制'));
  assert.ok(html.includes('placeholder'), '无图配方应有占位图');
});

test('卡片内容对 XSS 输入做转义', () => {
  const evil = {
    id: 'x', name_display: '<script>alert(1)</script>', name_zh: 'a',
    category: '"><img>', alcoholic: 'Alcoholic', image: 'x" onerror="alert(1)',
    ingredients_zh: ['<b>'], ingredients_en: [], instructions_zh: '', instructions_en: '',
    source: 'custom'
  };
  const html = UI.cardHtml(evil, {}, Tags);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('onerror="alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('列表为空时渲染空状态且带引导动作', () => {
  const html = UI.cardListHtml([], { empty: { ico: '🗄', text: '还没有收藏，去挑一瓶', action: { act: 'gotoRecommend', label: '去逛逛' } } }, Tags);
  assert.ok(html.includes('还没有收藏'));
  assert.ok(html.includes('去逛逛'));
  assert.ok(html.includes('data-act="gotoRecommend"'));
});

test('详情页含配料/做法/来源/价格档位', () => {
  const html = UI.detailHtml(mojito, { inCabinet: false, customTiers: null }, Tags);
  assert.ok(html.includes('配料'));
  assert.ok(html.includes('做法'));
  assert.ok(html.includes('青柠'), '应列出中文配料');
  assert.ok(html.includes('加入酒柜'));
  assert.ok(html.includes('返回'));
  assert.ok(html.includes('约 '), '应显示估算价格');
  assert.ok(html.includes('thecocktaildb'), '应有来源链接');
  assert.ok(!html.includes('删除'), '非自制配方不显示删除');
});

test('自制配方详情显示删除按钮', () => {
  const custom = { ...mojito, id: 'my-1', source: 'custom', image: '' };
  const html = UI.detailHtml(custom, { inCabinet: true }, Tags);
  assert.ok(html.includes('data-act="delCustom"'));
  assert.ok(html.includes('点击移除'));
});

test('筛选栏渲染搜索框/酒精度/分类胶囊', () => {
  const cats = Core.uniqueCategories(DRINKS).slice(0, 20);
  const html = UI.filterBarHtml({ q: 'mojito', alcoholic: 'yes', category: cats[0] }, cats);
  assert.ok(html.includes('id="searchInput"'));
  assert.ok(html.includes('value="mojito"'));
  assert.ok(html.includes('data-act="alc"'));
  assert.ok(html.includes('data-act="cat"'));
  assert.ok(html.includes('class="fchip on" data-act="cat" data-val="' + UI.esc(cats[0]) + '"'), '当前分类应高亮');
  assert.ok(html.includes('含酒精'));
});

test('盲盒页渲染档位/口感/酒精度与结果区', () => {
  const tiers = Tags.defaultTiers();
  const pool = Core.buildBlindPool(DRINKS, { tierIds: [], tastes: [] }, Tags);
  const html = UI.blindHtml({ pool, tierIds: ['t0', 't1'], tastes: ['浓烈'], alcoholic: '' }, tiers, Tags);
  assert.ok(html.includes('价格档位'));
  assert.ok(html.includes('可自定义'));
  assert.ok(html.includes('浓烈'));
  assert.ok(html.includes('符合条件：' + pool.length + ' 款'));
  assert.ok(html.includes('data-act="blindDraw"'));
  assert.ok(html.includes('data-act="tier"'));
  assert.ok(html.includes('data-act="taste"'));

  const emptyPool = UI.blindHtml({ pool: [] }, tiers, Tags);
  assert.ok(emptyPool.includes('放宽'));
  assert.ok(emptyPool.includes('disabled'), '池为空时抽按钮禁用');
});

test('盲盒出结果后展示详情与「再来一次」', () => {
  const tiers = Tags.defaultTiers();
  const html = UI.blindHtml({ pool: DRINKS.slice(0, 3), result: mojito, resultInCabinet: false }, tiers, Tags);
  assert.ok(html.includes('box-result'));
  assert.ok(html.includes('再来一次'));
  assert.ok(html.includes('莫吉托'));
});

test('新增配方表单字段齐全', () => {
  const html = UI.addFormHtml();
  for (const id of ['fName', 'fCategory', 'fAlc', 'fGlass', 'fIng', 'fStep', 'fErr']) {
    assert.ok(html.includes('id="' + id + '"'), '缺少字段 ' + id);
  }
  assert.ok(html.includes('data-act="saveRecipe"'));
});

test('设置菜单包含全部入口', () => {
  const html = UI.settingsHtml({ tierCount: 3 });
  for (const act of ['newRecipe', 'export', 'import', 'tiers', 'about', 'clearAll', 'closeOverlay']) {
    assert.ok(html.includes('data-act="' + act + '"'), '缺少入口 ' + act);
  }
});

test('价格档位编辑器支持增删改', () => {
  const html = UI.tiersHtml(Tags.defaultTiers());
  assert.ok(html.includes('data-tier-label="0"'));
  assert.ok(html.includes('data-tier-min="2"'));
  assert.ok(html.includes('data-act="delTier"'));
  assert.ok(html.includes('data-act="addTier"'));
  assert.ok(html.includes('data-act="saveTiers"'));
  assert.ok(html.includes('data-act="resetTiers"'));
  // 最高档 Infinity 显示为空（留空=不限）
  assert.ok(html.includes('placeholder="最高(留空=不限)"'));
});

test('关于页保留两家数据源署名', () => {
  const html = UI.aboutHtml();
  assert.ok(html.includes('TheCocktailDB'));
  assert.ok(html.includes('opendrinks'));
  assert.ok(html.includes('MIT'));
  assert.ok(html.includes('非商业'));
});

test('导入弹层提供合并/覆盖两种模式', () => {
  const html = UI.importHtml();
  assert.ok(html.includes('data-act="importMerge"'));
  assert.ok(html.includes('data-act="importReplace"'));
  assert.ok(html.includes('id="importErr"'));
});
