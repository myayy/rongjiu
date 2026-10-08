'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '素材', 'index.zh.json');
const OUT = path.join(ROOT, 'js', 'data.js');

function main() {
  const raw = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  const drinks = parsed.drinks;
  if (!Array.isArray(drinks)) throw new Error('index.zh.json 缺少 drinks 数组');
  if (drinks.length < 1395) throw new Error('配方数量异常: ' + drinks.length);

  const out = drinks.map((d) => ({
    id: d.id,
    name: d.name,
    name_zh: d.name_zh,
    name_display: d.name_display,
    category: d.category || '',
    alcoholic: d.alcoholic || '',
    glass: d.glass || '',
    ingredients_en: Array.isArray(d.ingredients_en) ? d.ingredients_en : [],
    ingredients_zh: Array.isArray(d.ingredients_zh) ? d.ingredients_zh : [],
    instructions_en: d.instructions_en || '',
    instructions_zh: d.instructions_zh || '',
    image: d.image ? '素材/' + String(d.image).replace(/\\/g, '/') : ''
  }));

  const banner = '/* 自动生成：tools/gen-data.js — 请勿手工修改 */\n';
  const body = banner + 'globalThis.DRINKS = ' + JSON.stringify(out) + ';\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, 'utf8');

  const missing = out.filter((d) => d.image && !fs.existsSync(path.join(ROOT, d.image)));
  console.log('生成完成: ' + out.length + ' 条 -> ' + path.relative(ROOT, OUT));
  console.log('缺图: ' + missing.length + (missing.length ? ' -> ' + missing.map((m) => m.image).join(', ') : ''));
}

main();
