/* 用户数据层：酒柜 / 自制配方 / 设置 / 备份导入导出 */
(function (global) {
  'use strict';

  var KEYS = {
    cabinet: 'rj.cabinet',
    custom: 'rj.custom',
    settings: 'rj.settings',
    seen: 'rj.blindSeen'
  };

  var SCHEMA = 1;

  function memoryStorage() {
    var map = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; }
    };
  }

  function pickStorage() {
    try {
      var s = global.localStorage;
      if (s) {
        var probe = '__rj_probe__';
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
      }
    } catch (e) { /* file:// 下某些浏览器禁用则回退内存 */ }
    return memoryStorage();
  }

  function createStore(storage) {
    var st = storage || pickStorage();

    function read(key, fallback) {
      var raw = st.getItem(key);
      if (raw === null || raw === undefined || raw === '') return fallback;
      try {
        var v = JSON.parse(raw);
        return v === null || v === undefined ? fallback : v;
      } catch (e) {
        return fallback;
      }
    }

    function write(key, value) {
      st.setItem(key, JSON.stringify(value));
    }

    var api = {};

    /* ----- 酒柜 ----- */
    api.getCabinet = function () {
      var v = read(KEYS.cabinet, []);
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
    };
    api.isInCabinet = function (id) {
      return api.getCabinet().indexOf(id) !== -1;
    };
    api.addCabinet = function (id) {
      if (typeof id !== 'string' || !id) throw new Error('非法 id');
      var list = api.getCabinet();
      if (list.indexOf(id) === -1) { list.push(id); write(KEYS.cabinet, list); return true; }
      return false;
    };
    api.removeCabinet = function (id) {
      var list = api.getCabinet();
      var next = list.filter(function (x) { return x !== id; });
      if (next.length !== list.length) { write(KEYS.cabinet, next); return true; }
      return false;
    };
    api.toggleCabinet = function (id) {
      return api.isInCabinet(id) ? (api.removeCabinet(id), false) : (api.addCabinet(id), true);
    };

    /* ----- 自制配方 ----- */
    api.getCustom = function () {
      var v = read(KEYS.custom, []);
      return Array.isArray(v) ? v : [];
    };
    api.addCustom = function (drink) {
      if (!drink || typeof drink !== 'object') throw new Error('非法配方');
      var name = String(drink.name_zh || drink.name_display || '').trim();
      if (!name) throw new Error('配方名称不能为空');
      if (!Array.isArray(drink.ingredients_zh) || drink.ingredients_zh.length === 0) {
        throw new Error('配料不能为空');
      }
      var list = api.getCustom();
      var id = 'my-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      var rec = {
        id: id,
        source: 'custom',
        name: drink.name || name,
        name_zh: drink.name_zh || name,
        name_display: drink.name_display || name,
        category: drink.category || '',
        alcoholic: drink.alcoholic || '',
        glass: drink.glass || '',
        ingredients_en: Array.isArray(drink.ingredients_en) ? drink.ingredients_en : [],
        ingredients_zh: drink.ingredients_zh.map(function (x) { return String(x); }),
        instructions_en: drink.instructions_en || '',
        instructions_zh: drink.instructions_zh || '',
        image: '',
        source_url: ''
      };
      list.unshift(rec);
      write(KEYS.custom, list);
      return rec;
    };
    api.removeCustom = function (id) {
      var list = api.getCustom();
      var next = list.filter(function (x) { return x.id !== id; });
      if (next.length !== list.length) { write(KEYS.custom, next); return true; }
      return false;
    };

    /* ----- 设置（含自定义价格档位） ----- */
    api.getSettings = function () {
      var v = read(KEYS.settings, {});
      return v && typeof v === 'object' ? v : {};
    };
    api.setSettings = function (patch) {
      var cur = api.getSettings();
      Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
      write(KEYS.settings, cur);
      return cur;
    };
    api.getPriceTiers = function () {
      return api.getSettings().priceTiers || null;
    };
    api.setPriceTiers = function (tiers) {
      return api.setSettings({ priceTiers: tiers });
    };

    /* ----- 盲盒去重记忆 ----- */
    api.getSeen = function () {
      var v = read(KEYS.seen, []);
      return Array.isArray(v) ? v : [];
    };
    api.pushSeen = function (id) {
      var v = api.getSeen();
      v.push(id);
      if (v.length > 50) v = v.slice(v.length - 50);
      write(KEYS.seen, v);
    };

    /* ----- 全量配方（主库 + 自制） ----- */
    api.allRecipes = function () {
      var base = Array.isArray(global.DRINKS) ? global.DRINKS : [];
      return api.getCustom().concat(base);
    };
    api.findRecipe = function (id) {
      var all = api.allRecipes();
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    };

    /* ----- 备份 ----- */
    api.exportBackup = function () {
      return {
        app: 'rongjiu',
        schema: SCHEMA,
        exported_at: new Date().toISOString(),
        cabinet: api.getCabinet(),
        custom: api.getCustom(),
        settings: api.getSettings()
      };
    };

    api.parseBackup = function (text) {
      var data;
      try {
        data = JSON.parse(String(text).replace(/^﻿/, ''));
      } catch (e) {
        throw new Error('不是有效的 JSON 文件');
      }
      if (!data || typeof data !== 'object') throw new Error('备份内容格式错误');
      if (data.app !== 'rongjiu') throw new Error('不是融酒的备份文件');
      if (typeof data.schema !== 'number' || data.schema > SCHEMA) throw new Error('备份版本不支持');
      if (!Array.isArray(data.cabinet) || !Array.isArray(data.custom)) throw new Error('备份缺少必要字段');
      return data;
    };

    api.importBackup = function (text, mode) {
      var data = api.parseBackup(text);
      if (mode === 'replace') {
        write(KEYS.cabinet, data.cabinet);
        write(KEYS.custom, data.custom);
        write(KEYS.settings, data.settings && typeof data.settings === 'object' ? data.settings : {});
      } else {
        var cab = api.getCabinet();
        data.cabinet.forEach(function (id) { if (cab.indexOf(id) === -1) cab.push(id); });
        write(KEYS.cabinet, cab);

        var custom = api.getCustom();
        var have = {};
        custom.forEach(function (c) { have[c.name_display] = true; });
        data.custom.forEach(function (c) {
          if (c && c.id && c.name_display && !have[c.name_display]) {
            custom.push(c);
            have[c.name_display] = true;
          }
        });
        write(KEYS.custom, custom);

        if (data.settings && typeof data.settings === 'object') api.setSettings(data.settings);
      }
      return { cabinet: api.getCabinet().length, custom: api.getCustom().length };
    };

    api.clearAll = function () {
      Object.keys(KEYS).forEach(function (k) { st.removeItem(KEYS[k]); });
    };

    api._storage = st;
    return api;
  }

  var api = { createStore: createStore, KEYS: KEYS, SCHEMA: SCHEMA, memoryStorage: memoryStorage };
  globalThis.RJStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
