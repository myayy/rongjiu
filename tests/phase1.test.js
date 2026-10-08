'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('js/data.js 存在且可加载', () => {
  const file = path.join(ROOT, 'js', 'data.js');
  assert.ok(fs.existsSync(file), 'js/data.js 不存在，先运行 node tools/gen-data.js');
  require(file);
  assert.ok(Array.isArray(globalThis.DRINKS), 'globalThis.DRINKS 应为数组');
});

test('配方总数为 1431（1395 主库 + 36 条兑酒）', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  assert.equal(globalThis.DRINKS.length, 1431);
});

test('每条配方字段完整', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  const required = ['id', 'name', 'name_zh', 'name_display', 'ingredients_zh', 'instructions_zh'];
  for (const d of globalThis.DRINKS) {
    for (const k of required) {
      assert.ok(d[k] !== undefined && d[k] !== null && d[k] !== '', `${d.id} 缺少字段 ${k}`);
    }
    assert.ok(Array.isArray(d.ingredients_zh), `${d.id} ingredients_zh 应为数组`);
    assert.ok(d.ingredients_zh.length > 0, `${d.id} 配料为空`);
    assert.match(d.id, /^(tcdb-\d+|od-.+|dy-.+|cn-.+)$/, `${d.id} 格式非法`);
    assert.match(d.name_display, /（.+）/, `${d.id} name_display 应为「中文（English）」格式`);
  }
});

test('id 全局唯一', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  const ids = new Set(globalThis.DRINKS.map((d) => d.id));
  assert.equal(ids.size, globalThis.DRINKS.length);
});

test('图片路径均指向真实文件', () => {
  require(path.join(ROOT, 'js', 'data.js'));
  let withImage = 0;
  for (const d of globalThis.DRINKS) {
    if (!d.image) continue;
    withImage++;
    assert.ok(
      fs.existsSync(path.join(ROOT, d.image)),
      `${d.id} 图片不存在: ${d.image}`
    );
  }
  assert.ok(withImage >= 1394, `带图配方应 >=1394，实际 ${withImage}`);
});

test('双击打开的 index.html 引用的所有本地资源路径合法', () => {
  const htmlPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(htmlPath)) return; // P4 之前允许尚未创建
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) {
    if (/^(https?:|#|data:)/.test(r)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, r)), `index.html 引用不存在: ${r}`);
  }
});
