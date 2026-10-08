'use strict';

/* 兑酒专区配图：把抖音搜索结果里的封面图下载到 素材/cn/。
   用法：
     node tools/fetch-mixer-images.js               下载缺失的图（已有且 >5KB 就跳过）
     node tools/fetch-mixer-images.js --force       重下全部
     node tools/fetch-mixer-images.js --dry         只打印选中哪张，不下载

   输入：
     - 素材/index.zh.json            取 cn- 配方的名称（拼文件名）与配料（挑图时打分）
     - tools/_covers/c*.json         抓取阶段存下的候选封面（url :: 标题）
   输出：
     - 素材/cn/<id>-<Name>.jpg
     - tools/mixer-image-sources.json   最终采用图源（便于日后核对/替换）
*/

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '素材', 'index.zh.json');
const COVER_DIR = path.join(__dirname, '_covers');
const OUT_DIR = path.join(ROOT, '素材', 'cn');
const SOURCES = path.join(__dirname, 'mixer-image-sources.json');

const FORCE = process.argv.indexOf('--force') !== -1;
const DRY = process.argv.indexOf('--dry') !== -1;

/* 兜底：抖音上找不到合适封面时，复用库里同源的真实调酒照片（本地文件，不走网络） */
const FALLBACK_LOCAL = {
  // 二锅头冰红茶 → 用「长岛冰茶」的实拍图（同为茶底 + 烈酒）
  'cn-035': 'thecocktaildb/images/11002-Long-Island-Tea.jpg'
};

/* 手动改选：默认按关键词命中挑，人脸/合集类的封面在这里指定用第几个候选（0 起） */
const CANDIDATE_OVERRIDE = {
  'cn-004': 2,
  'cn-007': 2,
  'cn-008': 2,
  'cn-018': 1,
  'cn-028': 2,
  'cn-032': 2
};

function slug(name) {
  return String(name || 'drink').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drink';
}

/* 从配料里挑出用于匹配封面的关键词（材料名，去掉用量） */
function keywords(ingredients) {
  const out = [];
  ingredients.forEach(function (line) {
    const m = /^([^（(]+)/.exec(String(line));
    const n = m ? m[1].trim() : '';
    if (n && n.length >= 2 && out.indexOf(n) === -1) out.push(n);
  });
  return out;
}

function readCovers() {
  const map = {};
  if (!fs.existsSync(COVER_DIR)) return map;
  // 文件名倒序：后抓的（c9…）排在前面，方便用 CANDIDATE_OVERRIDE 指定新候选
  const files = fs.readdirSync(COVER_DIR).filter(function (f) { return /^c\d+\.json$/.test(f); }).sort().reverse();
  files.forEach(function (f) {
    let arr;
    try {
      arr = JSON.parse(fs.readFileSync(path.join(COVER_DIR, f), 'utf8'));
    } catch (e) { return; }
    arr.forEach(function (item) {
      let inner = item.raw;
      try { inner = JSON.parse(item.raw); } catch (e) { inner = String(item.raw); }
      const list = String(inner).split(' ## ').filter(Boolean).map(function (pair) {
        const i = pair.indexOf(' :: ');
        return i < 0 ? { url: pair.trim(), title: '' } : { url: pair.slice(0, i).trim(), title: pair.slice(i + 4).trim() };
      }).filter(function (x) { return /^https?:/.test(x.url); });
      if (!list.length) return;
      const cur = map[item.id] || [];
      list.forEach(function (c) {
        if (!cur.some(function (y) { return y.url === c.url; })) cur.push(c);
      });
      map[item.id] = cur;
    });
  });
  return map;
}

function pick(cands, keys) {
  let best = null;
  let bestScore = -1;
  cands.forEach(function (c) {
    let score = 0;
    keys.forEach(function (k) { if (c.title.indexOf(k) !== -1) score++; });
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return { pick: best, score: bestScore };
}

function download(url, file) {
  return new Promise(function (resolve) {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://www.douyin.com/',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
      }
    }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, err: 'HTTP ' + res.statusCode });
      }
      const chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () {
        const buf = Buffer.concat(chunks);
        if (buf.length < 5120) return resolve({ ok: false, err: '太小 ' + buf.length });
        fs.writeFileSync(file, buf);
        resolve({ ok: true, bytes: buf.length });
      });
    });
    req.on('error', function (e) { resolve({ ok: false, err: String(e.message || e) }); });
    req.setTimeout(30000, function () { req.destroy(); resolve({ ok: false, err: '超时' }); });
  });
}

async function main() {
  const parsed = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
  const cn = parsed.drinks.filter(function (d) { return String(d.id).indexOf('cn-') === 0; });
  const covers = readCovers();
  // 原始抓取记录（_covers）已清理时，用上次记录的图源兜底，保证 --force 还能重下
  let recorded = {};
  if (fs.existsSync(SOURCES)) {
    try { recorded = JSON.parse(fs.readFileSync(SOURCES, 'utf8')); } catch (e) { recorded = {}; }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sources = {};
  let ok = 0, skip = 0, fail = 0;

  for (const d of cn) {
    const file = path.join(OUT_DIR, d.id + '-' + slug(d.name) + '.jpg');
    const rel = 'cn/' + path.basename(file);
    if (!FORCE && fs.existsSync(file) && fs.statSync(file).size > 5120) {
      sources[d.id] = { file: rel, reused: true };
      skip++;
      continue;
    }
    const keys = keywords(d.ingredients_zh || []);
    let cands = covers[d.id] || [];
    if (!cands.length && recorded[d.id] && recorded[d.id].url) {
      cands = [{ url: recorded[d.id].url, title: recorded[d.id].title || '（上次记录的图源）' }];
    }
    let chosen = pick(cands, keys);
    if (CANDIDATE_OVERRIDE[d.id] !== undefined && cands[CANDIDATE_OVERRIDE[d.id]]) {
      chosen = { pick: cands[CANDIDATE_OVERRIDE[d.id]], score: chosen.score };
    }
    let url = chosen.pick ? chosen.pick.url : null;
    let title = chosen.pick ? chosen.pick.title : '';
    let via = 'douyin';
    if (!url && FALLBACK_LOCAL[d.id]) {
      const src = path.join(ROOT, '素材', FALLBACK_LOCAL[d.id]);
      if (fs.existsSync(src)) {
        if (DRY) { console.log('· ' + d.id + ' [本地兜底] ' + FALLBACK_LOCAL[d.id] + ' -> ' + rel); continue; }
        fs.copyFileSync(src, file);
        ok++;
        sources[d.id] = { file: rel, via: 'local-fallback', from: FALLBACK_LOCAL[d.id] };
        console.log('✓ ' + d.id + ' [本地兜底] ' + FALLBACK_LOCAL[d.id]);
        continue;
      }
    }
    if (!url) { fail++; console.log('✗ ' + d.id + ' 没有可用图源'); continue; }

    if (DRY) {
      console.log('· ' + d.id + ' [' + via + ' 命中 ' + chosen.score + '] ' + title.slice(0, 50) + ' -> ' + rel);
      continue;
    }
    const r = await download(url, file);
    if (r.ok) {
      ok++;
      sources[d.id] = { file: rel, via: via, url: url, title: title, bytes: r.bytes };
      console.log('✓ ' + d.id + ' ' + (r.bytes / 1024).toFixed(0) + 'KB [' + via + '] ' + title.slice(0, 40));
    } else {
      fail++;
      console.log('✗ ' + d.id + ' 下载失败：' + r.err);
    }
  }

  if (!DRY) fs.writeFileSync(SOURCES, JSON.stringify(sources, null, 1), 'utf8');
  console.log('\n下载 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail + '，共 ' + cn.length + ' 款');
}

main();
