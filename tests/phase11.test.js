'use strict';

/* P11：自制配方上传照片（存入 rj.custom，刷新后仍在，卡片/详情可见） */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeEnv, click, El } = require('./fakedom');

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
    seed: opts.seed
  });
  app._env = env;
  app._store = store;
  app.start();
  return app;
}

function viewHtml(app) {
  return app._env.doc.getElementById('view').innerHTML;
}

/* 模拟选择照片：fImage change → FileReader.readAsDataURL → applyRecipeImage */
function uploadPhoto(app, dataUrl) {
  const input = app._env.doc.getElementById('fImage');
  input.files = [{ name: 'p.jpg' }];
  app._env.win.FileReader = function () {
    const r = this;
    this.readAsDataURL = function () {
      if (r.onload) r.onload({ target: { result: dataUrl } });
    };
  };
  input.dispatch('change', { target: input });
}

test('新增配方表单有照片上传控件与预览区', () => {
  const app = makeApp({ seed: 111 });
  app.handleAction('newRecipe', null);
  const html = app._env.doc.getElementById('overlay').innerHTML;
  assert.ok(html.includes('id="fImage"'), '应有照片上传');
  assert.ok(html.includes('accept="image/*"'));
  assert.ok(html.includes('id="fImgPreview"'));
});

test('选择照片后进入草稿并显示预览，保存后带图且刷新仍在', () => {
  const mem = RJStore.memoryStorage();
  const app = makeApp({ seed: 111, storage: mem });
  app.handleAction('newRecipe', null);

  const dataUrl = 'data:image/jpeg;base64,QUJDRA==';
  uploadPhoto(app, dataUrl);
  assert.equal(app.state.recipeDraft.image, dataUrl, '照片应进入草稿');

  app._env.doc.getElementById('fName').value = '我的特调';
  app._env.doc.getElementById('fIng').value = '45毫升伏特加\n';
  app._env.doc.getElementById('fStep').value = '摇匀。';
  const r = app.saveRecipe();
  assert.equal(r.ok, true);
  const rec = app._store.findRecipe(r.record.id);
  assert.equal(rec.image, dataUrl, '照片应随配方保存');

  // 推荐页卡片显示图片（dataURL 直接作为 img src）
  assert.ok(viewHtml(app).includes(dataUrl), '卡片应显示照片');
  // 详情页
  click(app._env.doc, { 'data-act': 'open', 'data-id': r.record.id });
  app.onHashChange();
  assert.ok(viewHtml(app).includes(dataUrl), '详情应显示照片');

  // 重新创建 app（模拟刷新）后仍在
  const app2 = makeApp({ seed: 222, storage: mem });
  const rec2 = app2._store.findRecipe(r.record.id);
  assert.ok(rec2, '刷新后配方仍在');
  assert.equal(rec2.image, dataUrl, '刷新后照片仍在');
});

test('不传照片也能正常保存（图片可选）', () => {
  const app = makeApp({ seed: 111 });
  app.handleAction('newRecipe', null);
  app._env.doc.getElementById('fName').value = '无图特调';
  app._env.doc.getElementById('fIng').value = '15毫升柠檬汁\n';
  const r = app.saveRecipe();
  assert.equal(r.ok, true);
  const rec = app._store.findRecipe(r.record.id);
  assert.equal(rec.image, '', '无照片则 image 为空');
  assert.ok(!viewHtml(app).includes('fImgPreview'), '卡片不出现照片');
});

test('备份导出/导入带自制照片', () => {
  const a = RJStore.createStore(RJStore.memoryStorage());
  a.addCustom({
    name_zh: '带图特调', name: '带图特调', name_display: '带图特调',
    ingredients_zh: ['30毫升金酒'],
    image: 'data:image/png;base64,SEk='
  });
  const b = RJStore.createStore(RJStore.memoryStorage());
  b.importBackup(JSON.stringify(a.exportBackup()), 'replace');
  const rec = b.getCustom()[0];
  assert.equal(rec.image, 'data:image/png;base64,SEk=');
});
