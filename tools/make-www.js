/* 组装 Capacitor 打包用的 www 目录（App 外壳 + 素材图片）。
   Capacitor 的 webDir 只能是单个目录，不能直接指向项目根目录
   （否则会把 android/、node_modules/、.git/ 一起打进去），
   所以这里把真正要进 App 的文件复制一份到 www/。
   用法：node tools/make-www.js */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'www');

var FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
var DIRS = ['css', 'js', 'icons', '素材'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

FILES.forEach(function (f) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
});

DIRS.forEach(function (d) {
  fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
});

function sizeOf(dir) {
  var total = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) total += sizeOf(p);
    else total += fs.statSync(p).size;
  });
  return total;
}

console.log('www 已生成: ' + OUT);
console.log('  文件数/体积: ' + Math.round(sizeOf(OUT) / 1048576 * 10) / 10 + ' MB');
