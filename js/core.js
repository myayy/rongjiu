/* 纯逻辑层：路由解析 / 列表筛选 / 盲盒抽取（无 DOM，可单测） */
(function (global) {
  'use strict';

  var PAGES = ['recommend', 'cabinet', 'box', 'history'];

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

  /* ----- 时间戳格式化：2026年10月08日 21点30分 ----- */
  function formatStamp(ms) {
    if (typeof ms !== 'number' && typeof ms !== 'string') return '';
    if (String(ms).trim() === '') return '';
    var t = Number(ms);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    var y = d.getFullYear();
    if (!isFinite(y)) return '';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return y + '年' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日 '
      + pad(d.getHours()) + '点' + pad(d.getMinutes()) + '分';
  }

  /* ----- 筛选 ----- */
  /* 查询分词：忽略空白与大小写；
     纯 ASCII 片段整段作为一个 token（否则 mojito 会被拆成 m/o/j… 命中全库）；
     含中文的片段逐字拆开（「莫托」→ 莫 / 托）。 */
  function queryTokens(q) {
    var s = String(q === undefined || q === null ? '' : q).trim().toLowerCase();
    if (!s) return [];
    var parts = s.split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (/^[\x00-\x7f]+$/.test(p)) { out.push(p); continue; }
      for (var j = 0; j < p.length; j++) out.push(p.charAt(j));
    }
    var uniq = [];
    for (var k = 0; k < out.length; k++) {
      if (uniq.indexOf(out[k]) === -1) uniq.push(out[k]);
    }
    return uniq;
  }

  /* 逐字匹配：任意一个 token 命中即保留（OR），所以「莫托」能找到「莫吉托」 */
  function matchesQuery(drink, q) {
    var tokens = queryTokens(q);
    if (!tokens.length) return true;
    var hay = [
      drink.name, drink.name_zh, drink.name_display, drink.category, drink.glass
    ].concat(drink.ingredients_zh || []).concat(drink.ingredients_en || []).join(' ').toLowerCase();
    for (var i = 0; i < tokens.length; i++) {
      if (hay.indexOf(tokens[i]) !== -1) return true;
    }
    return false;
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

  /* ----- 洗牌（随机种子打散顺序） -----
     同一 seed 结果固定：翻页 / 返回详情不会换位置；
     换一个 seed（每次打开 App）就是另一份顺序。 */
  function shuffle(list, seed) {
    var arr = (list || []).slice();
    var s = (Math.floor(seed) || 1) >>> 0;
    for (var i = arr.length - 1; i > 0; i--) {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      var r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      var j = Math.floor(r * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
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
    formatStamp: formatStamp,
    queryTokens: queryTokens,
    matchesQuery: matchesQuery,
    filterRecipes: filterRecipes,
    uniqueCategories: uniqueCategories,
    shuffle: shuffle,
    buildBlindPool: buildBlindPool,
    pickRandom: pickRandom
  };
  globalThis.RJCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
