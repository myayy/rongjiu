/* 纯逻辑层：路由解析 / 列表筛选 / 盲盒抽取（无 DOM，可单测） */
(function (global) {
  'use strict';

  var PAGES = ['recommend', 'cabinet', 'box'];

  function parseHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (!h) return { page: 'recommend', id: null, q: {} };
    var parts = h.split('?');
    var path = parts[0].replace(/^\//, '');
    var q = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = i < 0 ? kv : kv.slice(0, i);
        var v = i < 0 ? '' : kv.slice(i + 1);
        try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
        catch (e) { q[k] = v; }
      });
    }
    var m = path.match(/^drink\/(.+)$/);
    if (m) return { page: 'drink', id: m[1], q: q };
    if (PAGES.indexOf(path) !== -1) return { page: path, id: null, q: q };
    return { page: 'recommend', id: null, q: {} };
  }

  function buildHash(route) {
    var page = route.page || 'recommend';
    var base;
    if (page === 'drink') base = '#/drink/' + encodeURIComponent(route.id || '');
    else base = '#/' + (PAGES.indexOf(page) !== -1 ? page : 'recommend');
    var keys = Object.keys(route.q || {}).filter(function (k) {
      var v = route.q[k];
      return v !== '' && v !== undefined && v !== null;
    });
    if (!keys.length) return base;
    var qs = keys.map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(route.q[k]);
    }).join('&');
    return base + '?' + qs;
  }

  /* ----- 筛选 ----- */
  function matchesQuery(drink, q) {
    if (!q) return true;
    var s = String(q).trim().toLowerCase();
    if (!s) return true;
    var hay = [
      drink.name, drink.name_zh, drink.name_display, drink.category, drink.glass
    ].concat(drink.ingredients_zh || []).concat(drink.ingredients_en || []).join(' ').toLowerCase();
    return hay.indexOf(s) !== -1;
  }

  function matchesFilters(drink, filters, tagsApi) {
    if (filters.q && !matchesQuery(drink, filters.q)) return false;
    if (filters.alcoholic) {
      var a = String(drink.alcoholic || '');
      if (filters.alcoholic === 'yes' && a !== 'Alcoholic') return false;
      if (filters.alcoholic === 'no' && a !== 'Non alcoholic') return false;
    }
    if (filters.category) {
      if (String(drink.category || '') !== filters.category) return false;
    }
    if (filters.strength && tagsApi && tagsApi.strength(drink) !== filters.strength) return false;
    if (filters.ingredients && filters.ingredients.length && tagsApi) {
      var hit = false;
      for (var i = 0; i < filters.ingredients.length; i++) {
        if (tagsApi.hasIngredient(drink, filters.ingredients[i])) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return true;
  }

  function filterRecipes(list, filters, tagsApi) {
    filters = filters || {};
    var base = list.filter(function (d) { return matchesFilters(d, filters, tagsApi); });
    if (filters.tastes && filters.tastes.length && tagsApi) {
      base = base.filter(function (d) {
        var t = tagsApi.deriveTastes(d);
        for (var i = 0; i < filters.tastes.length; i++) {
          if (t.indexOf(filters.tastes[i]) !== -1) return true;
        }
        return false;
      });
    }
    // tierIds 存在即按档位过滤；空数组 = 一个都没选 = 空结果
    if (filters.tierIds !== undefined && filters.tierIds !== null && tagsApi) {
      var tiers = tagsApi.normalizeTiers(filters.customTiers);
      base = base.filter(function (d) {
        var tier = tagsApi.tierOf(tagsApi.estimatePrice(d), tiers);
        return tier && filters.tierIds.indexOf(tier.id) !== -1;
      });
    }
    return base;
  }

  function uniqueCategories(list) {
    var seen = {};
    var out = [];
    list.forEach(function (d) {
      var c = String(d.category || '').trim();
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    });
    out.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    return out;
  }

  /* ----- 分页（按页翻，像小说翻页） ----- */
  function pageSizeN(size) {
    return Math.max(1, parseInt(size, 10) || 30);
  }

  function pageCount(total, size) {
    var n = pageSizeN(size);
    var t = Math.max(0, parseInt(total, 10) || 0);
    return Math.max(1, Math.ceil(t / n));
  }

  function pageItems(list, page, size) {
    var n = pageSizeN(size);
    var total = pageCount(list.length, n);
    var p = Math.min(Math.max(1, parseInt(page, 10) || 1), total);
    var start = (p - 1) * n;
    return list.slice(start, start + n);
  }

  /* ----- 盲盒 ----- */
  function buildBlindPool(list, filters, tagsApi) {
    return filterRecipes(list, filters, tagsApi);
  }

  function pickRandom(pool, opts) {
    if (!pool || !pool.length) return null;
    var exclude = (opts && opts.exclude) || [];
    var candidates = pool.filter(function (d) { return exclude.indexOf(d.id) === -1; });
    if (!candidates.length) candidates = pool;
    var idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  var api = {
    PAGES: PAGES,
    parseHash: parseHash,
    buildHash: buildHash,
    matchesQuery: matchesQuery,
    filterRecipes: filterRecipes,
    uniqueCategories: uniqueCategories,
    pageCount: pageCount,
    pageItems: pageItems,
    buildBlindPool: buildBlindPool,
    pickRandom: pickRandom
  };
  globalThis.RJCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
