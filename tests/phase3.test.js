'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'data.js'));
const RJStore = require(path.join(ROOT, 'js', 'store.js'));

function newStore() {
  return RJStore.createStore(RJStore.memoryStorage());
}

const sample = {
  name_zh: '测试鸡尾酒',
  ingredients_zh: ['45毫升伏特加', '15毫升糖浆'],
  instructions_zh: '摇匀。',
  category: 'Cocktail',
  alcoholic: 'Alcoholic'
};

test('store API 完整', () => {
  const s = newStore();
  for (const k of ['getCabinet', 'addCabinet', 'removeCabinet', 'toggleCabinet', 'isInCabinet',
    'getCustom', 'addCustom', 'removeCustom', 'getSettings', 'setSettings',
    'getPriceTiers', 'setPriceTiers', 'exportBackup', 'parseBackup', 'importBackup', 'allRecipes', 'findRecipe', 'clearAll']) {
    assert.equal(typeof s[k], 'function', `缺少方法 ${k}`);
  }
});

test('酒柜增删改查与去重', () => {
  const s = newStore();
  assert.deepEqual(s.getCabinet(), []);
  assert.equal(s.addCabinet('tcdb-11000'), true);
  assert.equal(s.addCabinet('tcdb-11000'), false, '重复添加应返回 false');
  assert.deepEqual(s.getCabinet(), ['tcdb-11000']);
  assert.equal(s.isInCabinet('tcdb-11000'), true);
  assert.equal(s.toggleCabinet('tcdb-11000'), false, 'toggle 移除返回 false');
  assert.equal(s.isInCabinet('tcdb-11000'), false);
  assert.equal(s.toggleCabinet('od-zombie'), true, 'toggle 加入返回 true');
  assert.equal(s.removeCabinet('od-zombie'), true);
  assert.equal(s.removeCabinet('od-zombie'), false, '重复移除返回 false');
  assert.throws(() => s.addCabinet(''), /非法 id/);
});

test('自制配方校验与增删', () => {
  const s = newStore();
  assert.throws(() => s.addCustom(null), /非法配方/);
  assert.throws(() => s.addCustom({ name_zh: '   ' }), /名称不能为空/);
  assert.throws(() => s.addCustom({ name_zh: '无配料' }), /配料不能为空/);

  const rec = s.addCustom(sample);
  assert.match(rec.id, /^my-/);
  assert.equal(rec.name_display, '测试鸡尾酒');
  assert.equal(s.getCustom().length, 1);
  assert.equal(s.removeCustom(rec.id), true);
  assert.equal(s.getCustom().length, 0);
});

test('allRecipes 合并主库与自制，findRecipe 双向可查', () => {
  const s = newStore();
  const before = s.allRecipes().length;
  assert.equal(before, globalThis.DRINKS.length);
  const rec = s.addCustom(sample);
  assert.equal(s.allRecipes().length, before + 1);
  assert.equal(s.allRecipes()[0].id, rec.id, '自制配方排在最前');
  assert.ok(s.findRecipe('tcdb-11000'));
  assert.equal(s.findRecipe(rec.id).name_zh, '测试鸡尾酒');
  assert.equal(s.findRecipe('nope'), null);
});

test('自定义价格档位持久化', () => {
  const s = newStore();
  assert.equal(s.getPriceTiers(), null, '未设置时为 null（由 tags 回退默认）');
  const tiers = [{ label: 'A', min: 0, max: 10 }, { label: 'B', min: 10, max: 9999 }];
  s.setPriceTiers(tiers);
  assert.deepEqual(s.getPriceTiers(), tiers);
  s.setSettings({ foo: 1 });
  assert.equal(s.getSettings().foo, 1);
  assert.deepEqual(s.getPriceTiers(), tiers, '写其它设置不影响档位');
});

test('数据持久化到 storage（模拟刷新）', () => {
  const mem = RJStore.memoryStorage();
  const s1 = RJStore.createStore(mem);
  s1.addCabinet('tcdb-11000');
  s1.addCustom(sample);
  s1.setPriceTiers([{ label: 'X', min: 0, max: 1 }]);
  // 同一 storage 重新开 store = 模拟刷新
  const s2 = RJStore.createStore(mem);
  assert.deepEqual(s2.getCabinet(), ['tcdb-11000']);
  assert.equal(s2.getCustom().length, 1);
  assert.equal(s2.getPriceTiers()[0].label, 'X');
});

test('损坏的 localStorage 值不致崩溃，回退默认', () => {
  const mem = RJStore.memoryStorage();
  mem.setItem('rj.cabinet', '{{{not json');
  mem.setItem('rj.custom', 'null');
  const s = RJStore.createStore(mem);
  assert.deepEqual(s.getCabinet(), []);
  assert.deepEqual(s.getCustom(), []);
});

test('导出备份结构完整', () => {
  const s = newStore();
  s.addCabinet('tcdb-11000');
  s.addCustom(sample);
  const b = s.exportBackup();
  assert.equal(b.app, 'rongjiu');
  assert.equal(typeof b.schema, 'number');
  assert.ok(!Number.isNaN(Date.parse(b.exported_at)));
  assert.deepEqual(b.cabinet, ['tcdb-11000']);
  assert.equal(b.custom.length, 1);
  assert.equal(typeof b.settings, 'object');
});

test('导入：合并模式并集、不重复', () => {
  const a = newStore();
  a.addCabinet('tcdb-11000');
  const aRec = a.addCustom(sample);

  const b = newStore();
  b.addCabinet('od-zombie');
  b.addCustom({ name_zh: '另一杯', ingredients_zh: ['水'] });

  const res = b.importBackup(JSON.stringify(a.exportBackup()), 'merge');
  assert.equal(res.cabinet, 2);
  assert.equal(res.custom, 2);
  // 再导入一次不翻倍
  b.importBackup(JSON.stringify(a.exportBackup()), 'merge');
  assert.equal(b.getCabinet().length, 2);
  assert.equal(b.getCustom().length, 2);
  assert.ok(b.findRecipe(aRec.id));
});

test('导入：覆盖模式完全替换', () => {
  const a = newStore();
  a.addCabinet('tcdb-11000');
  a.addPantry('朗姆酒');
  a.setRating('tcdb-11000', 5);

  const b = newStore();
  b.addCabinet('od-zombie');
  b.addCustom(sample);
  b.setPriceTiers([{ label: 'Z', min: 0, max: 5 }]);
  b.addPantry('可乐');
  b.setRating('od-zombie', 2);

  b.importBackup(JSON.stringify(a.exportBackup()), 'replace');
  assert.deepEqual(b.getCabinet(), ['tcdb-11000']);
  assert.equal(b.getCustom().length, 0);
  assert.equal(b.getPriceTiers(), null, '覆盖后设置被清空');
  assert.deepEqual(b.getPantry(), ['朗姆酒'], '覆盖后材料被替换');
  assert.deepEqual(b.getRatings(), { 'tcdb-11000': 5 }, '覆盖后评分被替换');
});

test('导入非法输入给出明确错误', () => {
  const s = newStore();
  assert.throws(() => s.importBackup('not json', 'merge'), /不是有效的 JSON/);
  assert.throws(() => s.importBackup('{"app":"other"}', 'merge'), /不是融酒的备份/);
  assert.throws(() => s.importBackup('{"app":"rongjiu","schema":99}', 'merge'), /备份版本不支持/);
  assert.throws(() => s.importBackup('{"app":"rongjiu","schema":1,"cabinet":{}}', 'merge'), /缺少必要字段/);
  // 失败后原数据不受影响
  assert.deepEqual(s.getCabinet(), []);
});

test('导入带 BOM 的备份文件', () => {
  const a = newStore();
  a.addCabinet('tcdb-11000');
  const b = newStore();
  b.importBackup('﻿' + JSON.stringify(a.exportBackup()), 'replace');
  assert.deepEqual(b.getCabinet(), ['tcdb-11000']);
});

test('clearAll 清空所有用户数据', () => {
  const s = newStore();
  s.addCabinet('tcdb-11000');
  s.addCustom(sample);
  s.addPantry('朗姆酒');
  s.setRating('tcdb-11000', 4);
  s.clearAll();
  assert.deepEqual(s.getCabinet(), []);
  assert.deepEqual(s.getCustom(), []);
  assert.deepEqual(s.getSettings(), {});
  assert.deepEqual(s.getPantry(), []);
  assert.deepEqual(s.getRatings(), {});
});
