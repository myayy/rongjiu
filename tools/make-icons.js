/* 生成 PWA 图标：零依赖，直接用 Node 内置 zlib 解码/编码 PNG。
   素材：icons/icon-source.png（512×512 白底方图，由 design 原图裁切而来）。
   本脚本只做「等比缩放到各尺寸」，不再程序化绘制形状。
   用法：node tools/make-icons.js */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'icons');
var SRC = path.join(OUT_DIR, 'icon-source.png');

/* ---------- PNG 解码（8bit，非交错；支持灰度/RGB/RGBA 与 5 种滤镜） ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('不是 PNG 文件：' + SRC);
  }
  var off = 8, w = 0, h = 0, bd = 0, ct = 0, interlace = 0, idat = [];
  while (off + 8 <= buf.length) {
    var len = buf.readUInt32BE(off);
    var type = buf.toString('ascii', off + 4, off + 8);
    var data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bd = data[8];
      ct = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bd !== 8) throw new Error('仅支持 8bit PNG（当前 ' + bd + 'bit）');
  if (interlace !== 0) throw new Error('不支持交错 PNG');
  var ch = ct === 0 ? 1 : ct === 2 ? 3 : ct === 4 ? 2 : ct === 6 ? 4 : 0;
  if (!ch) throw new Error('不支持的颜色类型 ' + ct + '（请存为灰度/RGB/RGBA）');

  var raw = zlib.inflateSync(Buffer.concat(idat));
  var stride = w * ch;
  var px = Buffer.alloc(stride * h);
  var prev = Buffer.alloc(stride);
  for (var y = 0; y < h; y++) {
    var base = y * (stride + 1);
    var ft = raw[base];
    var cur = Buffer.from(raw.slice(base + 1, base + 1 + stride));
    for (var i = 0; i < stride; i++) {
      var a = i >= ch ? cur[i - ch] : 0;
      var b = prev[i];
      var c = i >= ch ? prev[i - ch] : 0;
      if (ft === 1) cur[i] = (cur[i] + a) & 255;
      else if (ft === 2) cur[i] = (cur[i] + b) & 255;
      else if (ft === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        var p = a + b - c;
        var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      } else if (ft !== 0) {
        throw new Error('未知滤镜类型 ' + ft);
      }
    }
    cur.copy(px, y * stride);
    prev = cur;
  }

  var rgba = Buffer.alloc(w * h * 4);
  for (var n = 0; n < w * h; n++) {
    var s = n * ch, d = n * 4;
    if (ch === 1) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ch === 2) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else if (ch === 3) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = px[s + 3]; }
  }
  return { w: w, h: h, rgba: rgba };
}

/* ---------- 面积平均缩放（等比，带 alpha 加权） ---------- */
function resize(src, sw, sh, size) {
  var out = Buffer.alloc(size * size * 4);
  for (var y = 0; y < size; y++) {
    var y0 = Math.floor(y * sh / size);
    var y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sh / size));
    for (var x = 0; x < size; x++) {
      var x0 = Math.floor(x * sw / size);
      var x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sw / size));
      var r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (var yy = y0; yy < y1; yy++) {
        for (var xx = x0; xx < x1; xx++) {
          var o = (yy * sw + xx) * 4;
          var al = src[o + 3] / 255;
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al;
          a += src[o + 3]; wsum += al;
        }
      }
      var d = (y * size + x) * 4;
      if (wsum > 0) {
        out[d] = Math.round(r / wsum);
        out[d + 1] = Math.round(g / wsum);
        out[d + 2] = Math.round(b / wsum);
      } else {
        out[d] = out[d + 1] = out[d + 2] = 255;
      }
      out[d + 3] = Math.round(a / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}

/* ---------- 最小 PNG 编码器 ---------- */
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  var sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // filter method
  ihdr[12] = 0;   // no interlace

  var raw = Buffer.alloc(size * (size * 4 + 1));
  for (var y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // 每行前面加一个 filter byte(0)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 输出 ---------- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(SRC)) {
  console.error('缺少素材 ' + path.relative(ROOT, SRC) + '：请先放入 512×512 的白底方图。');
  process.exit(1);
}

var art = decodePng(fs.readFileSync(SRC));
if (art.w !== art.h) {
  console.error('素材必须是正方形（当前 ' + art.w + '×' + art.h + '）');
  process.exit(1);
}

/* 1024 是 iOS App Store 要求的应用图标尺寸（AppIcon-512@2x.png），
   直接从 512 的素材放大一倍，平面图标不会糊。 */
[1024, 512, 192, 180].forEach(function (size) {
  var file = size === 180 ? 'apple-touch-icon.png' : 'icon-' + size + '.png';
  var out = path.join(OUT_DIR, file);
  var rgba = size === art.w ? art.rgba : resize(art.rgba, art.w, art.h, size);
  fs.writeFileSync(out, encodePng(size, rgba));
  console.log('wrote ' + path.relative(ROOT, out) + ' (' + size + 'px)');
});
