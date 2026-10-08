/* 生成 PWA 图标：零依赖，用 Node 内置 zlib 手写 PNG。
   设计：品牌色渐变底 + 白色马天尼杯（内容控制在 80% 安全圆内，可当 maskable 用）。
   用法：node tools/make-icons.js */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT_DIR = path.resolve(__dirname, '..', 'icons');

var ACCENT_TOP = [0xc0, 0x71, 0x35];   // 顶部亮一点
var ACCENT_BOTTOM = [0x93, 0x4c, 0x1c]; // 底部深一点
var WHITE = [0xff, 0xff, 0xff];
var OLIVE = [0x3f, 0x7d, 0x52];        // 复用主题里的绿

/* ---------- 形状（坐标都是 0~1 的相对值） ---------- */
function insideBowl(x, y) {
  var top = 0.29, apex = 0.53, hw = 0.205;
  if (y < top || y > apex) return false;
  var t = (y - top) / (apex - top);
  return Math.abs(x - 0.5) <= hw * (1 - t);
}
function insideStem(x, y) {
  return y >= 0.515 && y <= 0.735 && Math.abs(x - 0.5) <= 0.018;
}
function insideFoot(x, y) {
  return y >= 0.725 && y <= 0.765 && Math.abs(x - 0.5) <= 0.115;
}
function insideOlive(x, y) {
  var dx = x - 0.565, dy = y - 0.393;
  return dx * dx + dy * dy <= 0.037 * 0.037;
}

/* 取某点的颜色（0~1 坐标） */
function shade(x, y) {
  if (insideOlive(x, y)) return OLIVE;
  if (insideBowl(x, y) || insideStem(x, y) || insideFoot(x, y)) return WHITE;
  var t = Math.min(1, Math.max(0, y));
  return [
    Math.round(ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * t),
    Math.round(ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * t),
    Math.round(ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * t)
  ];
}

/* 3×3 超采样，让边缘不那么锯齿 */
function render(size) {
  var px = Buffer.alloc(size * size * 4);
  var SS = 3;
  for (var py = 0; py < size; py++) {
    for (var pxi = 0; pxi < size; pxi++) {
      var r = 0, g = 0, b = 0;
      for (var sy = 0; sy < SS; sy++) {
        for (var sx = 0; sx < SS; sx++) {
          var c = shade((pxi + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      var n = SS * SS;
      var o = (py * size + pxi) * 4;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = 255;
    }
  }
  return px;
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

  // 每行前面加一个 filter byte(0)
  var raw = Buffer.alloc(size * (size * 4 + 1));
  for (var y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
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

[192, 512].forEach(function (size) {
  var file = path.join(OUT_DIR, 'icon-' + size + '.png');
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log('wrote ' + path.relative(path.resolve(__dirname, '..'), file) + ' (' + size + 'px)');
});

// iOS 主屏图标（180×180）
var apple = path.join(OUT_DIR, 'apple-touch-icon.png');
fs.writeFileSync(apple, encodePng(180, render(180)));
console.log('wrote ' + path.relative(path.resolve(__dirname, '..'), apple) + ' (180px)');
