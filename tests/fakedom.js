'use strict';

/* 极简假 DOM：只为在 Node 中驱动 app.js 的装配逻辑。
   不解析 HTML，只维护 app.js 实际用到的接口。 */

function classListStub() {
  var set = new Set();
  return {
    add: function (c) { set.add(c); },
    remove: function (c) { set.delete(c); },
    contains: function (c) { return set.has(c); },
    set: set
  };
}

function El(tag, doc, attrs) {
  var self = this;
  this.tagName = (tag || 'div').toUpperCase();
  this.attributes = attrs || {};
  this.children = [];
  this.style = {};
  this.className = '';
  this.textContent = '';
  this.value = '';
  this.type = '';
  this.accept = '';
  this.download = '';
  this.href = '';
  this._doc = doc;
  this._listeners = {};
  this._innerHTML = '';
  this.classList = classListStub();
  this.files = [];
  this.parentNode = null;
  this.selectionStart = 0;
  this.selectionEnd = 0;
  this.setSelectionRange = function (a, b) { self.selectionStart = a; self.selectionEnd = b; };
  // 尺寸字段：真实 DOM 里未布局元素就是 0；显式声明避免 undefined 参与算术得出 NaN
  this.scrollTop = 0;
  this.scrollLeft = 0;
  this.clientHeight = 0;
  this.clientWidth = 0;
  this.scrollHeight = 0;
  this.scrollWidth = 0;

  this.setAttribute = function (k, v) { self.attributes[k] = String(v); };
  this.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(self.attributes, k) ? self.attributes[k] : null; };
  this.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(self.attributes, k); };

  Object.defineProperty(this, 'innerHTML', {
    get: function () { return self._innerHTML; },
    set: function (v) { self._innerHTML = String(v); self.children = []; self._syncClasses(); }
  });

  this._syncClasses = function () {
    var m = /class="([^"]*)"/.exec(self._innerHTML.slice(0, 400));
    // 容器类名不随 innerHTML 变化，忽略
    void m;
  };

  this.addEventListener = function (type, fn) {
    (self._listeners[type] = self._listeners[type] || []).push(fn);
  };
  this.removeEventListener = function (type, fn) {
    var l = self._listeners[type] || [];
    var i = l.indexOf(fn);
    if (i !== -1) l.splice(i, 1);
  };
  this.dispatch = function (type, event) {
    (self._listeners[type] || []).slice().forEach(function (fn) { fn(event); });
  };

  this.appendChild = function (c) { c.parentNode = self; self.children.push(c); return c; };
  this.removeChild = function (c) {
    var i = self.children.indexOf(c);
    if (i !== -1) self.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  this.remove = function () { if (self.parentNode) self.parentNode.removeChild(self); };

  this.click = function () {
    if (self._listeners.click) self.dispatch('click', { target: self, preventDefault: function () {} });
    if (typeof self.onclick === 'function') self.onclick({ target: self });
  };

  // 假 DOM 中 closest 只看自身属性
  this.closest = function (sel) {
    var m = /^\[data-act([=~^$]|$)/.exec(sel);
    if (sel === '[data-act]') return self.hasAttribute('data-act') ? self : null;
    void m;
    return self.hasAttribute('data-act') ? self : null;
  };
  this.querySelector = function () { return null; };
  this.querySelectorAll = function () { return []; };
  this.focus = function () {};
}

function FakeDoc() {
  var doc = this;
  this._registry = {};
  this.body = new El('body', doc);
  this.readyState = 'complete';

  this.getElementById = function (id) {
    if (!this._registry[id]) {
      var e = new El('div', doc);
      e.id = id;
      this._registry[id] = e;
    }
    return this._registry[id];
  };

  this.createElement = function (tag) { return new El(tag, doc); };

  this._tabEls = ['recommend', 'cabinet', 'box', 'mixer'].map(function (name) {
    var e = new El('a', doc);
    e.setAttribute('data-tab', name);
    e.className = 'tab';
    return e;
  });

  this.querySelectorAll = function (sel) {
    if (sel === '.tab') return doc._tabEls.slice();
    return [];
  };

  this.addEventListener = function (type, fn) {
    (doc._listeners = doc._listeners || {})[type] = (doc._listeners[type] || []);
    doc._listeners[type].push(fn);
  };
  doc._listeners = {};

  doc.dispatch = function (type, event) {
    (doc._listeners[type] || []).slice().forEach(function (fn) { fn(event); });
  };
}

/* 模拟一次点击：沿 target.closest('[data-act]') 找到动作元素并派发到 document */
function click(doc, attrs) {
  var el = new El('button', doc);
  Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  el.closest = function (sel) { return sel === '[data-act]' ? el : null; };
  doc.dispatch('click', { target: el, preventDefault: function () {} });
  return el;
}

function FakeWin() {
  var win = this;
  this.location = { hash: '' };
  this._listeners = {};
  this.history = {
    back: function () { win.__backCalls = (win.__backCalls || 0) + 1; }
  };
  this.setTimeout = function (fn) { return 0; };
  this.clearTimeout = function () {};
  this.confirm = function () { return true; };
  this.addEventListener = function (type, fn) {
    (win._listeners[type] = win._listeners[type] || []).push(fn);
  };
  this.dispatch = function (type, event) {
    (win._listeners[type] || []).slice().forEach(function (fn) { fn(event || { target: null }); });
  };
  // Blob / FileReader 桩由测试按需覆盖
  this.Blob = function (parts) { this.parts = parts; this.__isBlob = true; };
  this.URL = {
    createObjectURL: function () { return 'blob:fake'; },
    revokeObjectURL: function () {}
  };
  this.FileReader = function () {
    var r = this;
    this.readAsText = function () {
      r.__pending = true;
    };
    this.readAsDataURL = function () {
      r.__pending = true;
    };
    this.__resolve = function (text) {
      if (r.onload) r.onload({ target: { result: text } });
    };
  };
}

function makeEnv() {
  var doc = new FakeDoc();
  var win = new FakeWin();
  return { doc: doc, win: win };
}

module.exports = { FakeDoc: FakeDoc, FakeWin: FakeWin, El: El, click: click, makeEnv: makeEnv };
