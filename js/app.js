/* 应用装配层：路由渲染 + 事件绑定（依赖注入，便于在假 DOM 中测试） */
(function (global) {
  'use strict';

  var PAGE_TITLE = { recommend: '推荐', cabinet: '酒柜', box: '盲盒', history: '浏览历史', drink: '详情' };
  var PAGE_SIZE = 30;          // 每批加载条数
  var BOTTOM_THRESHOLD = 240;  // 距底部多少像素算「快到底」
  var ING_CHIPS = 60;          // 推荐页材料筛选胶囊个数

  function createApp(deps) {
    var doc = deps.doc;
    var win = deps.win;
    var store = deps.store;
    var core = deps.core;
    var ui = deps.ui;
    var tags = deps.tags;
    var nextRandom = typeof deps.random === 'function' ? deps.random : Math.random;
    var now = typeof deps.now === 'function' ? deps.now : Date.now;
    var rendered = false;   // 是否已完成首次渲染（首次渲染前不做 hash 幂等跳过）

    var state = {
      route: { page: 'recommend', id: null, q: {} },
      q: '',
      exact: false,         // 搜索「精确匹配」开关（只按酒名整串匹配）
      tastes: [],
      ingredients: [],
      strength: '',
      shown: PAGE_SIZE,     // 当前已加载条数（不是页码）
      lastTotal: 0,         // 上次渲染时过滤后的总数
      scrollMemo: 0,        // 离开推荐页进详情那一刻的滚动位置
      restoreScroll: false, // 下次渲染推荐页是否恢复滚动位置
      lastLoadTop: 0,       // 上次触发「加载更多」时的滚动位置
      pantryDraft: '',      // 「我的材料」输入框里还没提交的内容
      seed: 0,
      skip: 0,              // 「换一批」累计跳过的条数（每次向前滚一批，抽到新配方）
      blind: { tierIds: [], tastes: [], alcoholic: '', result: null, lastId: null },
      tierDraft: null,
      recipeDraft: null,
      share: null,          // 详情页「分享」弹层的配方 id
      cabinetQ: '',         // 酒柜页收藏搜索词
      cabinetMode: 'time',  // 酒柜收藏排序：time=按收藏时间 / spirit=按基酒分组
      overlay: null,
      confirm: null,        // 应用内确认弹层的文案与「确定」回调
      pool: []
    };

    /* 推荐页洗牌种子：每次打开 App 随机一次，重开不再是同一批顺序。
       同一会话内种子不变 —— 加载更多、进详情再返回看到的仍是同一份顺序。 */
    state.seed = (deps.seed === undefined || deps.seed === null)
      ? Math.floor(nextRandom() * 0x7fffffff)
      : deps.seed;

    /* ---------- 工具 ---------- */
    function esc(s) {
      return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function tiers() {
      return tags.normalizeTiers(store.getPriceTiers());
    }

    function toast(msg) {
      var el = doc.getElementById('toast');
      if (!el) return;
      el.textContent = String(msg);
      el.className = 'toast';
      if (win.__toastTimer) win.clearTimeout(win.__toastTimer);
      win.__toastTimer = win.setTimeout(function () {
        el.className = 'toast hidden';
      }, 1800);
    }

    function openOverlay(kind) {
      state.overlay = kind;
      renderOverlay();
    }

    /* 应用内确认弹层：不依赖原生 confirm（内置浏览器/被拦截时会静默失效） */
    function openConfirm(opts) {
      state.confirm = {
        title: opts.title || '请确认',
        text: opts.text || '',
        okLabel: opts.okLabel || '确定',
        cancelLabel: opts.cancelLabel || '取消',
        danger: !!opts.danger,
        run: opts.run
      };
      openOverlay('confirm');
    }

    function closeOverlay() {
      state.overlay = null;
      state.confirm = null;
      state.tierDraft = null;
      state.recipeDraft = null;
      var ov = doc.getElementById('overlay');
      if (ov) { ov.className = 'overlay hidden'; ov.innerHTML = ''; }
    }

    /* ---------- 视图 ---------- */
    function currentFilters() {
      return {
        q: state.q,
        exact: state.exact,
        tastes: state.tastes,
        ingredients: state.ingredients,
        strength: state.strength
      };
    }

    function hasFilter() {
      return !!(state.q || state.tastes.length || state.ingredients.length || state.strength);
    }

    /* 过滤 + 洗牌后的完整列表。
       必须保持「确定性」：同一 seed + 同一筛选 + 同一配方库 → 同一顺序。
       state.shown 切片依赖这个契约来保证「加载更多不会重复」。 */
    function filteredList() {
      // 内置配方按本次会话种子打散（每次打开 App 顺序不同、会话内稳定）；
      // 自制配方固定排在最前，方便刚加完就能看到
      var custom = store.getCustom();
      var mine = {};
      for (var i = 0; i < custom.length; i++) mine[custom[i].id] = true;
      var builtin = store.allRecipes().filter(function (d) { return !mine[d.id]; });
      var raw = custom.concat(core.shuffle(builtin, state.seed));
      // 按 id 去重：脏备份导入可能带来重复 id
      var seen = {};
      var uniq = [];
      for (var k = 0; k < raw.length; k++) {
        if (!seen[raw[k].id]) { seen[raw[k].id] = 1; uniq.push(raw[k]); }
      }
      var out = core.filterRecipes(uniq, currentFilters(), tags);
      var sec = currentSec();
      // sec='all' 是「浏览全部」不做过滤；sec='mine' 只看自制；其余按分区归类过滤
      if (sec === 'mine') out = out.filter(function (d) { return String(d.id).indexOf('my-') === 0; });
      else if (sec === 'spirits') {
        var sp = state.route.q && state.route.q.spirit;
        if (sp) out = out.filter(function (d) { return tags.spiritIdsOf(d).indexOf(sp) !== -1; });
      }
      else if (sec && sec !== 'all') out = out.filter(function (d) { return tags.sectionOf(d) === sec; });
      if (state.q) out = rankByQuery(out, state.q);
      else if (state.skip) {
        // 「换一批」把已看过的前 N 条滚到末尾，让下一批是没看过的（有搜索时排序优先，不滚）
        var k = state.skip % out.length;
        out = out.slice(k).concat(out.slice(0, k));
      }
      return out;
    }

    /* 当前所在分区（推荐页 ?sec=xxx），空串表示分区首页 */
    function currentSec() {
      return (state.route.q && state.route.q.sec) || '';
    }

    /* 搜索排序（稳定排序，同分保持洗牌顺序）：
       ① 酒名里出现「完整查询串」的最相关（搜「莫吉托」时先给莫吉托，而不是只含「吉」的酒）
       ② 其次按命中的字/词数量降序 —— 逐字 OR 匹配很宽松，命中字多的排前面才可用 */
    function rankByQuery(list, q) {
      var tokens = core.queryTokens(q);
      if (!tokens.length) return list;
      var raw = String(q).trim().toLowerCase();
      var rawFlat = raw.replace(/\s+/g, '');
      return list.map(function (d, idx) {
        var hay = [d.name, d.name_zh, d.name_display, d.category, d.glass]
          .concat(d.ingredients_zh || []).concat(d.ingredients_en || []).join(' ').toLowerCase();
        var hit = 0;
        for (var i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) !== -1) hit++;
        }
        var name = [d.name_zh, d.name_display, d.name].join(' ').toLowerCase();
        var nameFlat = name.replace(/\s+/g, '');
        var exact = (raw && (name.indexOf(raw) !== -1
          || (rawFlat && nameFlat.indexOf(rawFlat) !== -1))) ? 1 : 0;
        return { d: d, hit: hit, exact: exact, idx: idx };
      }).sort(function (a, b) {
        return b.exact - a.exact || b.hit - a.hit || a.idx - b.idx;
      }).map(function (x) { return x.d; });
    }

    function recommendParts() {
      var list = filteredList();
      var shown = list.slice(0, Math.max(state.shown, PAGE_SIZE));
      return {
        total: list.length,
        shown: shown.length,
        listBox: ui.cardListHtml(shown, ui_lastRecommendOpts(list), tags),
        footer: ui.listFooterHtml(shown.length, list.length)
      };
    }

    /* 结果区（列表 + 底部）单独包一层 #listWrap：
       搜索打字时只换这一层，上面的搜索框节点保持不动。 */
    function listRegionHtml(parts) {
      return '<div id="listBox">' + parts.listBox + '</div>' + parts.footer;
    }

    /* 筛选条外层。货架首页用 .bar-min 只露搜索框，进列表形态后展开全部筛选胶囊。
       两种形态共用同一段 DOM，只为后面「打字不重建搜索框」留出切换余地。 */
    function filterHostHtml(extraClass) {
      var hist = (!state.q && !state.exact) ? ui.searchHistoryHtml(store.getSearchHistory()) : '';
      return '<div id="filterHost" class="filter-host' + (extraClass ? ' ' + extraClass : '') + '">'
        + ui.filterBarHtml(currentFilters(), tags.commonIngredients(store.allRecipes(), ING_CHIPS), tags)
        + hist
        + '</div>';
    }

    /* 推荐页两种形态：
       ① 没筛选、也没进分区 → 货架首页（横向分区，像视频网站那样左右滑）
       ② 有搜索/筛选，或从「全部 ›」进了某个分区 → 纵向列表
       ③ sec=spirits 且没选具体基酒 → 基酒总览页 */
    function renderRecommend() {
      if (currentSec() === 'spirits' && !state.route.q.spirit) { renderSpiritIndex(); return; }
      if (!currentSec() && !hasFilter()) { renderShelf(); return; }
      var parts = recommendParts();
      state.lastTotal = parts.total;
      var sec = currentSec();
      var head = '';
      if (sec === 'spirits') {
        var sp = tags.spiritById(state.route.q.spirit);
        if (sp) head = '<div class="sec-head">'
          + '<button class="back-btn" data-act="moreSection" data-val="spirits">← 全部基酒</button>'
          + '<div class="sec-title"><h3>' + esc(sp.label) + '</h3>'
          + '<span class="sec-count">' + parts.total + ' 款</span></div></div>';
      } else {
        head = sec ? ui.sectionHeadHtml(tags.sectionById(sec), parts.total) : '';
      }
      var html = head
        + filterHostHtml('')
        + '<div id="listWrap">' + listRegionHtml(parts) + '</div>';
      view().innerHTML = html;
      // 同步 listBox（Node 假 DOM 中与 view 分离；真实 DOM 中为幂等）
      var lb = doc.getElementById('listBox');
      if (lb && lb !== view()) lb.innerHTML = parts.listBox;
      bindSearch();
      syncHash();
      // 注意：这里不要动 scrollTop —— 「加载更多」必须保持当前位置
    }

    /* 基酒总览页：列出全部基酒与数量，点进去看「所有用到该基酒的配方」（不受互斥分区限制） */
    function renderSpiritIndex() {
      var list = store.allRecipes();
      var groups = tags.groupBySpirit(list);
      view().innerHTML = '<div class="sec-head">'
        + '<button class="back-btn" data-act="backShelf">← 全部</button>'
        + '<div class="sec-title"><h3>全部基酒</h3><span class="shelf-hint">每款酒可能同时属于多个基酒，这里不受分区互斥限制</span></div>'
        + '</div>'
        + '<div class="spirit-list">'
        + groups.map(function (g) {
          return '<button class="spirit-item" data-act="moreSection" data-val="spirits" data-spirit="' + esc(g.id) + '">'
            + '<span class="spirit-name">' + esc(g.label) + '</span>'
            + '<span class="spirit-count">' + g.drinks.length + ' 款</span><span class="entry-arrow">›</span></button>';
        }).join('')
        + '</div>';
      syncHash();
    }

    /* 货架首页：内置配方按分区横向铺开，自制配方单独一排放最前 */
    function renderShelf() {
      var custom = store.getCustom();
      var builtin = store.allRecipes().filter(function (d) {
        return String(d.id).indexOf('my-') !== 0;
      });
      // 按本次会话种子打散，保证「换一批」在货架首页也有效
      var sections = tags.groupSections(core.shuffle(builtin, state.seed));
      if (custom.length) {
        sections.unshift({ id: 'mine', label: '我的自制', hint: '你自己加进去的配方', drinks: custom });
      }
      state.lastTotal = sections.reduce(function (n, s) { return n + s.drinks.length; }, 0);
      state.shown = PAGE_SIZE;   // 回首页视为重新浏览
      view().innerHTML = filterHostHtml('bar-min')
        + '<div id="listWrap">'
        + '<div id="allEntry">' + ui.allEntryHtml(store.allRecipes().length) + '</div>'
        + '<button class="entry-btn compact" data-act="moreSection" data-val="spirits">'
        + '<span class="entry-ico">🥃</span>'
        + '<span class="entry-label">查看全部基酒</span>'
        + '<span class="entry-val">按基酒找配方</span>'
        + '<span class="entry-arrow">›</span></button>'
        + ui.shelfHtml(sections, tags, 12)
        + '</div>';
      bindSearch();
      // 清空搜索等场景会落回货架首页，这里要把 URL 一并复位，别留着旧的 ?q=
      syncHash();
    }

    /* 打字时只刷新结果区，不重建搜索框。
       手机上如果每敲一个字就把输入框整个换掉，中文输入法的组词会被打断、
       软键盘会收起，表现就是「搜索没反应」。
       返回 false 表示当前 DOM 不具备局部更新的条件（假 DOM / 首屏尚未渲染），
       调用方回退到整页渲染。 */
    function refreshListOnly() {
      var host = doc.getElementById('filterHost');
      var wrap = doc.getElementById('listWrap');
      // parentNode 为空说明节点没真正挂到文档上（Node 假 DOM 就是这种情况）
      if (!host || !host.parentNode || !wrap || !wrap.parentNode) return false;
      // 空查询要落回货架首页，那是另一种形态，交给整页渲染
      if (!currentSec() && !hasFilter()) return false;
      host.className = 'filter-host';      // 首页 → 列表：展开口味/材料/强度胶囊
      var parts = recommendParts();
      state.lastTotal = parts.total;
      wrap.innerHTML = listRegionHtml(parts);
      syncHash();
      return true;
    }

    /* 把推荐页筛选条件写回 URL：
       进详情再返回时能回到原来的筛选，而不是丢掉。
       用 replaceState 不新增历史记录（file:// 下被拒时退回直接改 hash）。 */
    function syncHash() {
      if (state.route.page !== 'recommend' || !win.location) return;
      var sec = currentSec();
      var q = {
        sec: sec,
        q: state.q,
        tastes: state.tastes.join(','),
        ingredients: state.ingredients.join(','),
        strength: state.strength
      };
      if (sec === 'spirits' && state.route.q && state.route.q.spirit) q.spirit = state.route.q.spirit;
      var hash = core.buildHash({ page: 'recommend', q: q });
      if (win.location.hash === hash) return;
      try {
        if (win.history && win.history.replaceState) {
          win.history.replaceState(null, '', hash);
          return;
        }
      } catch (e) { /* file:// 下 replaceState 可能被拒绝，走下面的兜底 */ }
      win.location.hash = hash;
    }

    /* 回到推荐页时把列表复位到第一批并回顶部 */
    function resetRecommendList() {
      state.shown = PAGE_SIZE;
      state.restoreScroll = false;
      state.scrollMemo = 0;
      state.lastLoadTop = 0;
    }

    /* 追加一批（触底 / 点「加载更多」共用）。
       重设 innerHTML 会把滚动位置清零，所以这里显式保住原位置。 */
    function appendBatch() {
      if (state.shown >= state.lastTotal) return false;
      var v0 = view();
      var keep = v0 ? (v0.scrollTop || 0) : 0;
      state.lastLoadTop = keep;      // 记住这次触发的位置，同一位置不再重复追加
      state.shown += PAGE_SIZE;
      renderRecommend();
      var after = view();
      if (after) after.scrollTop = keep;
      return true;
    }

    function isNearBottom(el) {
      var ch = el.clientHeight || 0;
      var sh = el.scrollHeight || 0;
      if (!ch || !sh) return false;   // 未布局（假 DOM / 隐藏）时不触发
      return (el.scrollTop || 0) + ch >= sh - BOTTOM_THRESHOLD;
    }

    function onViewScroll() {
      if (state.route.page !== 'recommend') return;
      // 货架首页是横向分区，没有「加载更多」，不要触发触底追加
      if (!currentSec() && !hasFilter()) return;
      var v = view();
      if (!v) return;
      if (!isNearBottom(v)) return;
      // 只有比上次触发的位置更靠下才算「又滑到底了」，
      // 否则滑到底后追加的内容会把位置顶开，一次手势会连跳好几批。
      if ((v.scrollTop || 0) <= state.lastLoadTop) return;
      appendBatch();
    }

    function bindSearch() {
      var input = doc.getElementById('searchInput');
      if (!input || input.__rjBound) return;
      input.__rjBound = true;
      input.addEventListener('input', function (e) {
        // 中文输入法正在组词（拼音还没落成汉字）时先不动界面：
        // 这时重渲染会把输入框连同组词一起打断
        if (e && e.isComposing) {
          state.q = String(e.target.value || '');
          return;
        }
        applyQuery(e.target.value, e.target);
      });
      // 组词结束后补一次渲染，把刚敲下的中文搜出来
      input.addEventListener('compositionend', function (e) {
        if (e && e.target && e.target.value !== undefined) applyQuery(e.target.value, e.target);
      });
      // 回车把当前词记进搜索历史
      input.addEventListener('keydown', function (e) {
        var enter = e.key === 'Enter' || e.keyCode === 13;
        if (enter && state.q && state.q.trim()) {
          try { store.pushSearchHistory(state.q); } catch (err) { /* 记不上没关系 */ }
          // 回车后仍停在推荐页，刷新历史胶囊（不重渲染以免丢焦点，靠 historyRefresh）
          var hb = doc.getElementById('searchHistory');
          if (hb) hb.innerHTML = ui.searchHistoryHtml(store.getSearchHistory());
        }
      });
    }

    /* 应用一次搜索词：先记状态，再优先走「只换列表」的路子 */
    function applyQuery(value, inputEl) {
      state.q = String(value == null ? '' : value);
      state.shown = PAGE_SIZE;
      state.restoreScroll = false;
      state.scrollMemo = 0;
      if (refreshListOnly()) return;
      // 回退：整页重渲染后，把焦点和光标塞回搜索框
      var pos = inputEl && typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : null;
      renderRecommend();
      if (view()) view().scrollTop = 0;
      var again = doc.getElementById('searchInput');
      if (again) {
        if (again.focus) again.focus();
        if (pos !== null && again.setSelectionRange) {
          try { again.setSelectionRange(pos, pos); } catch (err) { /* number input 不支持 */ }
        }
      }
    }

    function ui_lastRecommendOpts(list) {
      return {
        ratings: store.getRatings(),      // 卡片上显示「已喝过 ★N」
        empty: {
          ico: '🔍',
          text: list.length === 0 ? '未找到相关配方，换个关键词或清除筛选试试' : '配方库为空',
          action: hasFilter() ? { act: 'clearFilter', label: '清除筛选' } : null
        }
      };
    }

    /* 一次性迁移：早期版本会把「朗姆酒 / 可乐 / 青柠汁」整串存成一个材料，
       这里按分隔符 / 别名 / 单位重新拆开重建，脏标签自动消失。
       幂等：已经干净的数据跑完不会改动，也不写盘。 */
    function migratePantry() {
      var list = store.getPantry();
      if (!list.length) return false;
      var fixed = [];
      var changed = false;
      list.forEach(function (name) {
        var parts = tags.splitIngredients(name);
        if (parts.length !== 1 || parts[0] !== name) changed = true;
        parts.forEach(function (p) { if (p && fixed.indexOf(p) === -1) fixed.push(p); });
      });
      if (fixed.length !== list.length) changed = true;
      if (!changed) return false;
      try { store.setPantry(fixed); } catch (e) { return false; }
      return true;
    }

    /* 「我的材料」建议区：空输入给高频前 24 个，有输入就按关键词过滤 */
    function pantrySuggestNames() {
      var pool = tags.ingredientPool(store.allRecipes());
      var kw = String(state.pantryDraft || '').trim();
      if (!kw) return pool.slice(0, 24).map(function (it) { return it.name; });
      // 可能是一行多个（朗姆酒 / 可），取最后一段当关键词，符合边打边筛的直觉
      var parts = kw.split(/[\/、,;；\s]+/).filter(Boolean);
      var word = parts.length ? parts[parts.length - 1] : kw;
      // 允许输英文（vodka）或带单位（30毫升朗姆酒）：归一化后一起匹配
      var keys = [word, tags.aliasOf(tags.ingredientName(word)) || word];
      var hits = pool.filter(function (it) {
        var n = it.name.toLowerCase();
        for (var i = 0; i < keys.length; i++) {
          var k = String(keys[i]).toLowerCase();
          if (k && n.indexOf(k) !== -1) return true;
        }
        return false;
      });
      return hits.slice(0, 24).map(function (it) { return it.name; });
    }

    /* 酒柜页：我的材料 → 能做的酒 → 我的酒柜 → 喝过的酒 → 浏览历史入口 */
    function renderCabinet() {
      var ids = store.getCabinet();
      var cabinet = ids.map(function (id) { return store.findRecipe(id); }).filter(Boolean);
      // 我的酒柜：按搜索词过滤，再按分组/时间排序（保留 id 顺序的旧收藏在前）
      var q = String(state.cabinetQ || '').trim().toLowerCase();
      if (q) {
        cabinet = cabinet.filter(function (d) {
          var hay = (d.name_display || d.name_zh || d.name || '') + ' ' + (d.category || '') + ' '
            + (d.ingredients_zh || []).join(' ') + ' ' + (d.ingredients_en || []).join(' ');
          return hay.toLowerCase().indexOf(q) !== -1;
        });
      }
      if (state.cabinetMode === 'time') {
        cabinet = cabinet.slice().sort(function (a, b) {
          return (store.getCabinetAt(b.id) || 0) - (store.getCabinetAt(a.id) || 0);
        });
      }
      var pantry = store.getPantry();
      var groups = pantry.length ? tags.pantryGroups(store.allRecipes(), pantry) : { ready: [], near: [] };
      var ratings = store.getRatings();
      var rated = Object.keys(ratings).map(function (id) {
        return { drink: store.findRecipe(id), rating: ratings[id] };
      }).filter(function (x) { return x.drink; }).sort(function (a, b) {
        return b.rating - a.rating ||
          String(a.drink.name_display).localeCompare(String(b.drink.name_display), 'zh');
      });
      var history = store.getHistory().map(function (x) {
        return { drink: store.findRecipe(x.id), at: x.at, stamp: core.formatStamp(x.at) };
      }).filter(function (x) { return x.drink; });
      view().innerHTML = ui.cabinetHtml({
        pantry: pantry,
        pantryDraft: state.pantryDraft,
        pantrySuggest: pantrySuggestNames(),
        ready: groups.ready,
        near: groups.near,
        cabinet: cabinet,
        cabinetQ: state.cabinetQ,
        cabinetMode: state.cabinetMode,
        rated: rated,
        history: history
      }, tags);
    }

    /* 浏览历史（独立页面，从酒柜页底部的入口进来） */
    function renderHistory() {
      var history = store.getHistory().map(function (x) {
        return { drink: store.findRecipe(x.id), at: x.at, stamp: core.formatStamp(x.at) };
      }).filter(function (x) { return x.drink; });
      view().innerHTML = ui.historyPageHtml(history, tags);
    }

    function renderDetail(id) {
      var d = store.findRecipe(id);
      if (!d) {
        view().innerHTML = ui.emptyHtml({
          ico: '🤔', text: '找不到这个配方', action: { act: 'gotoRecommend', label: '回到推荐' }
        });
        return;
      }
      view().innerHTML = ui.detailHtml(d, {
        inCabinet: store.isInCabinet(d.id),
        customTiers: store.getPriceTiers(),
        rating: store.getRating(d.id)
      }, tags);
    }

    /* 盲盒档位当前生效的选中集合：
       null 表示「还没动过 → 默认全选」；[] 表示「全部取消 → 不限价格」；否则是选中的档位 id */
    function blindEffectiveTiers() {
      var t = tiers();
      if (state.blind.tierIds === null) return t.map(function (x) { return x.id; });
      return state.blind.tierIds;
    }

    function recomputePool() {
      // null（未动过）或选了档位就把价格限制到这些档；[] 表示全取消 = 不限价格
      var eff = blindEffectiveTiers();
      state.pool = core.buildBlindPool(store.allRecipes(), {
        tierIds: eff.length ? eff : null,
        tastes: state.blind.tastes,
        alcoholic: state.blind.alcoholic,
        customTiers: store.getPriceTiers()
      }, tags);
    }

    function renderBox() {
      recomputePool();
      view().innerHTML = ui.blindHtml({
        pool: state.pool,
        tierIds: blindEffectiveTiers(),
        tastes: state.blind.tastes,
        alcoholic: state.blind.alcoholic,
        result: state.blind.result,
        resultInCabinet: state.blind.result ? store.isInCabinet(state.blind.result.id) : false
      }, tiers(), tags);
    }

    function renderDrink() {
      renderDetail(state.route.id);
    }

    function view() { return doc.getElementById('view'); }

    function render() {
      var page = state.route.page;
      doc.getElementById('pageTitle').textContent = PAGE_TITLE[page] || '推荐';
      var tabs = doc.querySelectorAll('.tab');
      var hl = page === 'history' ? 'cabinet' : page;   // 历史页从酒柜进，高亮酒柜
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var act = t.getAttribute('data-tab') === hl || (page === 'drink' && t.getAttribute('data-tab') === 'recommend');
        if (act) t.className = 'tab active';
        else t.className = 'tab';
      }
      if (page === 'recommend') renderRecommend();
      else if (page === 'cabinet') renderCabinet();
      else if (page === 'box') renderBox();
      else if (page === 'history') renderHistory();
      else if (page === 'drink') renderDrink();
      renderOverlay();
      rendered = true;
    }

    function renderOverlay() {
      var ov = doc.getElementById('overlay');
      if (!ov) return;
      if (!state.overlay) { ov.className = 'overlay hidden'; ov.innerHTML = ''; return; }
      ov.className = 'overlay';
      var kind = state.overlay;
      if (kind === 'settings') ov.innerHTML = ui.settingsHtml({ tierCount: tiers().length, theme: store.getTheme() });
      else if (kind === 'share') ov.innerHTML = ui.shareHtml(state.share ? (store.findRecipe(state.share) || {}).name_display || '' : '');
      else if (kind === 'newRecipe') { ov.innerHTML = ui.addFormHtml(state.recipeDraft || null); bindRecipeImageInput(); }
      else if (kind === 'tiers') ov.innerHTML = ui.tiersHtml(state.tierDraft || tiers(), state.tierErr || '');
      else if (kind === 'about') ov.innerHTML = ui.aboutHtml();
      else if (kind === 'confirm') ov.innerHTML = ui.confirmHtml(state.confirm || {});
      else if (kind === 'import') ov.innerHTML = ui.importHtml();
    }

    /* ---------- 导航 ---------- */
    function navigate(hash) {
      win.location.hash = hash;
    }

    function onHashChange() {
      var r = core.parseHash(win.location.hash);

      // 幂等跳过：hash 只是 syncHash() 写出去的回声（file:// 下必然发生）。
      // 若重渲染，正在输入的搜索框会被销毁、焦点丢失。
      if (rendered && r.page === state.route.page && r.id === state.route.id && sameFilters(r)) return;

      var restore = false;
      state.route = r;

      if (r.page === 'recommend') {
        if (state.restoreScroll && sameFilters(r)) {
          restore = true;                 // 从详情返回：保留已加载条数，稍后恢复滚动位置
        } else {
          resetRecommendList();           // 新一次的推荐页浏览：回到第一批、回顶部
        }
        state.q = r.q.q || '';
        state.tastes = r.q.tastes ? String(r.q.tastes).split(',') : [];
        state.ingredients = r.q.ingredients ? String(r.q.ingredients).split(',') : [];
        state.strength = r.q.strength || '';
      } else if (r.page !== 'drink') {
        // 切到酒柜 / 盲盒：放弃待恢复的滚动位置
        resetRecommendList();
      } else if (r.id) {
        // 进详情就记浏览历史：除了点卡片，直接打开或刷新详情页也要能记上
        try { store.pushHistory(r.id, now()); } catch (e) { /* 记不上不影响浏览 */ }
      }
      // 进详情：保留 restoreScroll / scrollMemo，等返回时用

      if (r.page !== 'box') { state.blind.result = state.blind.result; }
      render();

      var v = view();
      if (v) {
        v.scrollTop = restore ? (state.scrollMemo || 0) : 0;
        if (restore) state.restoreScroll = false;
      }
    }

    /* hash 里的筛选条件是否与当前 state 一致 */
    function sameFilters(r) {
      var t = r.q.tastes ? String(r.q.tastes).split(',') : [];
      var i = r.q.ingredients ? String(r.q.ingredients).split(',') : [];
      return (r.q.q || '') === state.q
        && t.join(',') === state.tastes.join(',')
        && i.join(',') === state.ingredients.join(',')
        && (r.q.strength || '') === state.strength
        // 分区也要比：否则从货架点「全部 ›」会被当成 hash 回声跳过、页面不刷新
        && (r.q.sec || '') === currentSec()
        // 基酒也要比：否则点另一个基酒会被当成回声跳过
        && (r.q.spirit || '') === (state.route.q ? (state.route.q.spirit || '') : '');
    }

    /* 手机返回键（Android 物理键 / 返回手势）该做什么。
       顺序：先关弹层 → 再退一层页面 → 都没有了才让调用方退出应用。
       返回 'exit' 表示「已经在最外层，可以退出应用了」。 */
    function back() {
      if (state.overlay) { closeOverlay(); return 'overlay'; }
      var page = state.route.page;
      if (page === 'drink' || page === 'history') {
        if (win.history && typeof win.history.back === 'function' && win.history.length > 1) {
          win.history.back();
          return 'back';
        }
        navigate(page === 'history' ? '#/cabinet' : '#/recommend');
        return 'back';
      }
      // 推荐页的分区列表 / 搜索结果 → 退回货架首页。
      // 这里不要顺手改 state：清掉筛选后 onHashChange 会以为「URL 和 state 一样」而跳过重渲染，
      // 留给它自己发现差异才会真的重画。
      if (page === 'recommend' && (currentSec() || hasFilter())) {
        if (currentSec() === 'spirits' && state.route.q && state.route.q.spirit) {
          navigate(core.buildHash({ page: 'recommend', q: { sec: 'spirits' } }));   // 基酒配方 → 回基酒总览
        } else {
          navigate('#/recommend');   // 分区/基酒总览/搜索 → 回货架首页
        }
        return 'back';
      }
      return 'exit';
    }

    /* ---------- 备份 ---------- */
    function exportBackup() {
      var data = store.exportBackup();
      var text = JSON.stringify(data, null, 2);
      var d = new Date();
      var name = '融酒备份-' + d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + '.json';
      var ok = false;
      try {
        var blob = new win.Blob([text], { type: 'application/json' });
        var url = win.URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url;
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        win.URL.revokeObjectURL(url);
        ok = true;
      } catch (e) { ok = false; }
      return { ok: ok, name: name, text: text };
    }

    /* 分享：把配方拼成一段文本，复制到剪贴板（Android 有原生分享面板就用它） */
    function shareText() {
      var d = (state.share && store.findRecipe(state.share)) || null;
      if (!d) { closeOverlay(); return; }
      var lines = ['【' + (d.name_display || d.name_zh) + '】', '', '配料：'];
      (d.ingredients_zh || []).forEach(function (x) { lines.push('· ' + x); });
      lines.push('');
      lines.push('做法：' + (d.instructions_zh || '未填写'));
      var text = lines.join('\n');
      var done = function (ok) {
        closeOverlay();
        toast(ok ? '已复制食谱文本' : '复制失败，请手动复制');
      };
      try {
        if (win.navigator && win.navigator.share) {
          win.navigator.share({ title: d.name_display, text: text }).then(function () {
            closeOverlay();
          }).catch(function () { done(false); });
          return;
        }
      } catch (e) { /* 继续走剪贴板 */ }
      var copied = false;
      try {
        if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
          win.navigator.clipboard.writeText(text).then(function () { done(true); })
            .catch(function () { done(false); });
          return;
        }
      } catch (e) { /* 老浏览器无 clipbooard */ }
      // 兜底：用隐藏 textarea + execCommand
      try {
        var ta = doc.createElement('textarea');
        ta.value = text;
        doc.body.appendChild(ta);
        ta.select();
        copied = doc.execCommand ? doc.execCommand('copy') : false;
        ta.remove();
      } catch (e) { copied = false; }
      done(copied);
    }

    /* 分享：把配方渲染成一张卡片图，下载保存 */
    function shareImage() {
      var d = (state.share && store.findRecipe(state.share)) || null;
      if (!d) { closeOverlay(); return; }
      closeOverlay();
      toast('正在生成卡片图…');
      ui.recipeCardToImage ? null : null; // 占位，避免 lint
      try {
        if (globalThis.RJUICard && globalThis.RJUICard.render) {
          globalThis.RJUICard.render(d).then(function (dataUrl) {
            var a = doc.createElement('a');
            a.href = dataUrl;
            a.download = (d.name_display || d.name_zh || '配方') + '.png';
            doc.body.appendChild(a);
            a.click();
            a.remove();
            toast('已生成卡片图，请到下载里查看');
          }).catch(function () { toast('生成图片失败'); });
          return;
        }
      } catch (e) { /* fallthrough */ }
      toast('当前环境不支持生成图片');
    }

    function pickFile(onText) {
      var input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var reader = new win.FileReader();
        reader.onload = function () { onText(String(reader.result), null); };
        reader.onerror = function () { onText(null, '读取文件失败'); };
        reader.readAsText(f, 'utf-8');
      };
      doc.body.appendChild(input);
      input.click();
    }

    function applyImport(text, mode) {
      try {
        var res = store.importBackup(text, mode);
        // 旧备份里可能带着「整串」脏材料标签，导入后顺手迁移一次
        var cleaned = migratePantry();
        resetRecommendList();
        closeOverlay();
        render();
        var tail = cleaned ? '，材料标签已自动整理' : '';
        toast(mode === 'replace'
          ? '已覆盖导入（' + res.cabinet + ' 瓶酒柜 / ' + res.custom + ' 自制）' + tail
          : '已合并导入（' + res.cabinet + ' 瓶酒柜 / ' + res.custom + ' 自制）' + tail);
        return { ok: true, result: res };
      } catch (e) {
        var errEl = doc.getElementById('importErr');
        if (errEl) errEl.textContent = e.message;
        toast('导入失败：' + e.message);
        return { ok: false, error: e.message };
      }
    }

    /* ---------- 表单 ---------- */
    function readRecipeDraft() {
      var d = state.recipeDraft || {};
      function val(id) {
        var el = doc.getElementById(id);
        return el ? String(el.value || '') : (d[id] || '');
      }
      return {
        name_zh: val('fName').trim(),
        category: val('fCategory').trim(),
        alcoholic: val('fAlc'),
        glass: val('fGlass').trim(),
        ing: val('fIng'),
        step: val('fStep').trim(),
        image: (d && d.image) || ''
      };
    }

    function saveRecipe() {
      var d = readRecipeDraft();
      var errEl = doc.getElementById('fErr');
      function fail(msg) { if (errEl) errEl.textContent = msg; return { ok: false, error: msg }; }
      if (!d.name_zh) return fail('请填写名称');
      var lines = d.ing.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return fail('请至少填写一行配料');
      var editingId = (state.recipeDraft && state.recipeDraft.editId) || null;
      var rec;
      try {
        if (editingId) {
          rec = store.updateCustom(editingId, {
            name_zh: d.name_zh,
            category: d.category,
            alcoholic: d.alcoholic,
            glass: d.glass,
            ingredients_zh: lines,
            instructions_zh: d.step,
            image: d.image
          });
        } else {
          rec = store.addCustom({
            name_zh: d.name_zh,
            name: d.name_zh,
            name_display: d.name_zh,
            category: d.category,
            alcoholic: d.alcoholic,
            glass: d.glass,
            ingredients_zh: lines,
            instructions_zh: d.step,
            image: d.image
          });
        }
      } catch (e) {
        return fail(e.message);
      }
      closeOverlay();
      state.q = '';
      state.tastes = [];
      state.ingredients = [];
      state.strength = '';
      resetRecommendList();
      if (editingId) navigate(core.buildHash({ page: 'drink', id: editingId }));
      else navigate(core.buildHash({ page: 'recommend', q: {} }));
      render();
      if (view()) view().scrollTop = 0;
      toast(editingId ? '已更新：' + rec.name_display : '已保存：' + rec.name_display);
      return { ok: true, record: rec };
    }

    /* 打开「编辑自制配方」：读原数据回填表单，保存时覆盖原记录 */
    function editCustom(id) {
      var d = store.findRecipe(id);
      if (!d || String(d.id).indexOf('my-') !== 0) return;
      state.recipeDraft = {
        editId: id,
        image: d.image || '',
        _name: d.name_display || d.name_zh || '',
        _source: d
      };
      openOverlay('newRecipe');
    }

    function saveTiers() {
      var draft = state.tierDraft || [];
      function tierFail(msg) {
        state.tierErr = msg;
        renderOverlay();
        return { ok: false, error: msg };
      }
      var clean = [];
      var droppedEmpty = 0;
      for (var i = 0; i < draft.length; i++) {
        var t = draft[i];
        var label = String(t.label || '').trim();
        if (!label) { droppedEmpty++; continue; }
        var min = Number(t.min);
        var max = t.max === '' || t.max === null || t.max === undefined ? Infinity : Number(t.max);
        if (!isFinite(min)) min = 0;
        if (Number.isNaN(max)) max = Infinity;
        clean.push({ label: label, min: min, max: max });
      }
      // 有档位没填名称时不静默丢弃，明确提示，避免用户以为加成功了
      if (droppedEmpty) {
        return tierFail('有 ' + droppedEmpty + ' 个档位还没填名称，请补全或点 ✕ 删掉它');
      }
      if (clean.length < 1) return tierFail('至少保留一个档位');
      for (var j = 0; j < clean.length; j++) {
        if (clean[j].max <= clean[j].min) {
          return tierFail('「' + clean[j].label + '」的最高价必须大于最低价');
        }
      }
      store.setPriceTiers(clean);
      state.tierErr = '';
      state.blind.tierIds = null;   // 档位改了，旧的选中 id 已失效；默认回到「全选」
      state.blind.result = null;
      closeOverlay();
      render();
      toast('价格档位已保存');
      return { ok: true, tiers: clean };
    }

    /* ---------- 盲盒 ---------- */
    function blindDraw() {
      recomputePool();
      if (!state.pool.length) { toast('当前条件没有匹配的酒'); return { ok: false }; }
      var picked = core.pickRandom(state.pool, { exclude: state.blind.lastId ? [state.blind.lastId] : [] });
      state.blind.result = picked;
      state.blind.lastId = picked.id;
      render();
      return { ok: true, result: picked };
    }

    /* ---------- 事件 ---------- */
    function handleAction(act, el) {
      var id = el ? el.getAttribute('data-id') : null;
      switch (act) {
        case 'open':
          // 记住离开时的滚动位置，返回推荐页时恢复
          if (state.route.page === 'recommend' && view()) {
            state.scrollMemo = view().scrollTop || 0;
            state.restoreScroll = true;
          }
          if (id) { try { store.pushHistory(id, now()); } catch (e) { /* 记不上不影响浏览 */ } }
          navigate(core.buildHash({ page: 'drink', id: id }));
          break;
        case 'back':
          win.history.back();
          break;
        case 'toggle': {
          var added = store.toggleCabinet(id);
          toast(added ? '已加入酒柜' : '已从酒柜移除');
          render();
          break;
        }
        case 'rate': {
          var rv = parseInt(el.getAttribute('data-val'), 10);
          if (!isFinite(rv)) break;
          var cur = store.getRating(id);
          try { store.setRating(id, cur === rv ? 0 : rv); } catch (e) { break; }
          toast(store.getRating(id) ? '已评 ' + store.getRating(id) + ' 星' : '已取消评价');
          render();
          break;
        }
        case 'addPantry':
          addPantryFromDraft();
          break;
        case 'addPantryName': {
          // 建议区里点一下直接加
          var nm = el.getAttribute('data-val');
          var okAdd = false;
          try { okAdd = store.addPantry(nm); } catch (e) { /* ignore */ }
          state.pantryDraft = '';
          renderCabinet();
          toast(okAdd ? '已加入材料：' + nm : '这个材料已经在列表里了');
          break;
        }
        case 'delPantry':
          store.removePantry(el.getAttribute('data-val'));
          renderCabinet();
          break;
        case 'delHistory':
          store.removeHistory(el.getAttribute('data-val'));
          render();
          break;
        case 'clearHistory':
          openConfirm({
            title: '清空浏览历史？',
            text: '浏览历史会被全部删除，且无法恢复。',
            okLabel: '清空',
            danger: true,
            run: function () {
              store.clearHistory();
              render();
              toast('浏览历史已清空');
            }
          });
          break;
        case 'loadMore':
          appendBatch();
          break;
        case 'refreshList':
          // 「换一批」：把窗口往后滚一批，让下一批是之前没看到的配方（而不是原地重排）。
          // 有搜索词/筛选时排序优先，不滚动；货架首页走的是 seed 重打散。
          if (!state.q && !currentSec()) {
            state.seed = Math.floor(nextRandom() * 0x7fffffff);
          } else {
            state.skip += PAGE_SIZE;
          }
          resetRecommendList();
          renderRecommend();
          if (view()) view().scrollTop = 0;
          break;
        case 'toggleExact':
          state.exact = el.getAttribute('data-val') === '1';
          resetRecommendList();
          if (state.route.page === 'recommend') renderRecommend();
          break;
        case 'searchHist':
          state.q = el.getAttribute('data-val') || '';
          resetRecommendList();
          if (currentSec() && currentSec() !== 'spirits' && !hasFilter()) { /* stay */ }
          renderRecommend();
          if (view()) view().scrollTop = 0;
          break;
        case 'clearSearchHist':
          try { store.clearSearchHistory(); } catch (e) {}
          state.q = '';
          resetRecommendList();
          renderRecommend();
          break;
        case 'fTaste': {
          var tv = el.getAttribute('data-val');
          var ti = state.tastes.indexOf(tv);
          if (ti === -1) state.tastes.push(tv); else state.tastes.splice(ti, 1);
          resetRecommendList();
          render();
          if (view()) view().scrollTop = 0;
          break;
        }
        case 'fIng': {
          var iv = el.getAttribute('data-val');
          var ii = state.ingredients.indexOf(iv);
          if (ii === -1) state.ingredients.push(iv); else state.ingredients.splice(ii, 1);
          resetRecommendList();
          render();
          if (view()) view().scrollTop = 0;
          break;
        }
        case 'fStr':
          state.strength = el.getAttribute('data-val');
          resetRecommendList();
          render();
          if (view()) view().scrollTop = 0;
          break;
        case 'alc':
          state.blind.alcoholic = el.getAttribute('data-val');
          state.blind.result = null;
          render();
          break;
        case 'clearFilter':
          state.q = ''; state.tastes = []; state.ingredients = []; state.strength = '';
          resetRecommendList();
          render();
          if (view()) view().scrollTop = 0;
          break;
        case 'editCustom':
          editCustom(id);
          break;
        case 'cabMode':
          state.cabinetMode = el.getAttribute('data-val') === 'spirit' ? 'spirit' : 'time';
          renderCabinet();
          break;
        case 'gotoRecommend':
          navigate('#/recommend');
          break;
        case 'moreSection': {
          // 从货架点「全部 ›」进某个分区的完整列表；基酒总览点某款基酒进该基酒的全部配方
          var secVal = el.getAttribute('data-val');
          var sp = el.getAttribute('data-spirit');
          if (secVal === 'spirits') {
            state.skip = 0;
            navigate(sp
              ? core.buildHash({ page: 'recommend', q: { sec: 'spirits', spirit: sp } })
              : core.buildHash({ page: 'recommend', q: { sec: 'spirits' } }));
          } else {
            navigate(core.buildHash({ page: 'recommend', q: { sec: secVal } }));
          }
          break;
        }
        case 'backShelf':
          // 从分区列表回货架首页：顺手清掉筛选，保证落回首页形态
          state.q = ''; state.tastes = []; state.ingredients = []; state.strength = '';
          state.skip = 0;
          navigate('#/recommend');
          break;
        case 'gotoHistory':
          navigate('#/history');
          break;
        case 'backToCabinet':
          navigate('#/cabinet');
          break;
        case 'tier': {
          var tid = el.getAttribute('data-val');
          // 默认全选：第一次点某档 = 从「全选」里取消这一档
          if (state.blind.tierIds === null) state.blind.tierIds = tiers().map(function (x) { return x.id; });
          var k = state.blind.tierIds.indexOf(tid);
          if (k === -1) state.blind.tierIds.push(tid); else state.blind.tierIds.splice(k, 1);
          state.blind.result = null;
          render();
          break;
        }
        case 'taste': {
          var tv = el.getAttribute('data-val');
          var ta = state.blind.tastes;
          var ti = ta.indexOf(tv);
          if (ti === -1) ta.push(tv); else ta.splice(ti, 1);
          state.blind.result = null;
          render();
          break;
        }
        case 'blindDraw':
          blindDraw();
          break;
        case 'blindAgain':
          blindDraw();
          break;
        case 'closeOverlay':
          closeOverlay();
          break;
        case 'settings':
          openOverlay('settings');
          break;
        case 'newRecipe':
          state.recipeDraft = {};
          openOverlay('newRecipe');
          break;
        case 'saveRecipe':
          return saveRecipe();
        case 'tiers':
          state.tierErr = '';
          state.tierDraft = tiers().map(function (t) {
            return { label: t.label, min: t.min, max: t.max === Infinity ? '' : t.max };
          });
          openOverlay('tiers');
          break;
        case 'addTier':
          state.tierDraft = (state.tierDraft || []).concat([{ label: '', min: '', max: '' }]);
          renderOverlay();
          break;
        case 'delTier': {
          var idx = parseInt(el.getAttribute('data-idx'), 10);
          (state.tierDraft || []).splice(idx, 1);
          renderOverlay();
          break;
        }
        case 'resetTiers':
          state.tierDraft = tags.defaultTiers().map(function (t) {
            return { label: t.label, min: t.min, max: t.max === Infinity ? '' : t.max };
          });
          renderOverlay();
          break;
        case 'saveTiers':
          return saveTiers();
        case 'about':
          openOverlay('about');
          break;
        case 'share':
          state.share = id;
          openOverlay('share');
          break;
        case 'shareText':
          shareText();
          break;
        case 'shareImage':
          shareImage();
          break;
        case 'toggleTheme':
          store.setTheme(store.getTheme() === 'dark' ? 'light' : 'dark');
          applyTheme();
          renderOverlay();
          break;
        case 'export': {
          var r = exportBackup();
          if (r.ok) { toast('已导出：' + r.name); closeOverlay(); }
          else toast('导出失败，请检查浏览器是否允许下载');
          return r;
        }
        case 'import':
          openOverlay('import');
          break;
        case 'importMerge':
          pickFile(function (text, err) {
            if (err) { var e1 = doc.getElementById('importErr'); if (e1) e1.textContent = err; return; }
            applyImport(text, 'merge');
          });
          break;
        case 'importReplace':
          // 覆盖导入是破坏性操作：先弹出醒目的红色确认，再选文件
          openConfirm({
            title: '覆盖导入？',
            text: '覆盖导入会清空当前本地所有配方、酒柜数据，无法恢复！建议先导出备份。',
            okLabel: '我已备份，继续覆盖',
            danger: true,
            run: function () {
              pickFile(function (text, err) {
                if (err) { var e2 = doc.getElementById('importErr'); if (e2) e2.textContent = err; return; }
                applyImport(text, 'replace');
              });
            }
          });
          break;
        case 'clearAll':
          openConfirm({
            title: '清空全部数据？',
            text: '酒柜、自制配方、我的材料、评分和浏览历史都会被删除，且无法恢复。建议先导出备份。',
            okLabel: '确定清空',
            danger: true,
            run: function () {
              store.clearAll();
              state.blind.result = null;
              state.blind.tierIds = null;
              resetRecommendList();
              closeOverlay();
              render();
              toast('已清空全部数据');
            }
          });
          break;
        case 'delCustom':
          openConfirm({
            title: '删除这个自制配方？',
            text: '删除后无法恢复。',
            okLabel: '删除',
            danger: true,
            run: function () {
              store.removeCustom(id);
              resetRecommendList();
              navigate('#/recommend');
              render();
              toast('已删除');
            }
          });
          break;
        case 'confirmYes': {
          var yes = state.confirm && state.confirm.run;
          closeOverlay();
          if (yes) yes();
          break;
        }
        case 'confirmNo':
          closeOverlay();
          break;
        default:
          break;
      }
      return undefined;
    }

    /* 提交「我的材料」输入框里的内容（回车 / 点＋时调用）
       支持一次填多个：朗姆酒 / 可乐 / 青柠汁；也认英文（vodka）与带单位写法 */
    function addPantryFromDraft() {
      // 优先读输入框里的实时值：只认 state.pantryDraft 的话，
      // 一旦输入事件没触发（手机输入法/自动填充会偶发），点了＋就会毫无反应
      var inp = doc.getElementById('pantryInput');
      var text = (inp && inp.value !== undefined && inp.value !== null) ? inp.value : state.pantryDraft;
      var names = tags.splitIngredients(text);
      if (!names.length) {
        // 绝不静默返回：什么都不发生的话用户根本不知道是没输入还是坏了
        toast('请先输入材料名，再点「＋」');
        return false;
      }
      var added = [];
      names.forEach(function (n) {
        try { if (store.addPantry(n)) added.push(n); } catch (e) { /* 单个失败不影响其余 */ }
      });
      state.pantryDraft = '';
      renderCabinet();
      var again = doc.getElementById('pantryInput');
      if (again) {
        if (again.focus) again.focus();
        if (again.setSelectionRange) {
          try { again.setSelectionRange(0, 0); } catch (err) { /* 某些 input 类型不支持 */ }
        }
      }
      if (added.length === 1) toast('已加入材料：' + added[0]);
      else if (added.length > 1) toast('已加入 ' + added.length + ' 种材料');
      else toast('这些材料已经在列表里了');
      return added.length > 0;
    }

    /* 上传的自制配方照片：压缩成小尺寸 JPEG dataURL 存本地，避免撑爆 localStorage */
    function applyRecipeImage(dataUrl) {
      state.recipeDraft = state.recipeDraft || {};
      var doDownscale = function (url) {
        try {
          var img = new win.Image();
          img.onload = function () {
            var MAX = 640;
            var w = img.width, h = img.height;
            var scale = Math.min(1, MAX / Math.max(w, h));
            if (scale >= 1) { setDraft(url); return; }
            var c = doc.createElement('canvas');
            c.width = Math.round(w * scale);
            c.height = Math.round(h * scale);
            var ctx = c.getContext && c.getContext('2d');
            if (!ctx) { setDraft(url); return; }
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var out = c.toDataURL('image/jpeg', 0.72);
            setDraft(out);
          };
          img.onerror = function () { setDraft(url); };
          img.src = url;
        } catch (e) { setDraft(url); }
      };
      var setDraft = function (url) {
        state.recipeDraft.image = url;
        var pv = doc.getElementById('fImgPreview');
        if (pv) pv.innerHTML = '<img src="' + url + '" alt="配方照片">';
        if (win.__imgDone) win.__imgDone(url);
      };
      if (typeof win.Image === 'function' && typeof doc.createElement === 'function') doDownscale(dataUrl);
      else setDraft(dataUrl);
    }

    function bindRecipeImageInput() {
      var input = doc.getElementById('fImage');
      if (!input || input.__rjImgBound) return;
      input.__rjImgBound = true;
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var reader = new win.FileReader();
        reader.onload = function (e) {
          var url = e && e.target && e.target.result;
          if (url == null) url = reader.result;
          applyRecipeImage(String(url));
        };
        reader.onerror = function () { toast('读取图片失败'); };
        try { reader.readAsDataURL(f); } catch (e) { toast('读取图片失败'); }
      });
    }

    function bindEvents() {
      function onDocClick(e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!el) return;
        var act = el.getAttribute('data-act');
        if (!act) return;
        e.preventDefault();
        handleAction(act, el);
      }
      doc.addEventListener('click', onDocClick);

      // 点遮罩空白处关闭弹层（只有点在 .sheet 外面才算，弹层内部点哪都不关）
      var ovEl = doc.getElementById('overlay');
      if (ovEl && ovEl.addEventListener) {
        ovEl.addEventListener('click', function (e) {
          if (!state.overlay) return;
          if (e.target === ovEl) closeOverlay();
        });
      }

      // 推荐页滑到底自动加载更多（滚动容器是 #view，元素本身不会被替换）
      var viewEl = doc.getElementById('view');
      if (viewEl && viewEl.addEventListener) {
        viewEl.addEventListener('scroll', onViewScroll, { passive: true });
      }

      // 表单/档位输入：事件委托，避免整页重渲染丢焦点
      doc.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        // 「我的材料」输入框：打字阶段只记草稿 + 局部刷新建议区，不整页重渲染（否则丢焦点）
        if (t.getAttribute('data-pantry-input') !== null) {
          state.pantryDraft = String(t.value || '');
          var sg = doc.getElementById('pantrySuggest');
          if (sg) sg.innerHTML = ui.pantrySuggestHtml(pantrySuggestNames(), state.pantryDraft);
          return;
        }
        // 酒柜收藏搜索框：只更新 state + 重画酒柜（输入框在列表上方，不在被替换的卡片区，焦点安全）
        if (t.getAttribute('data-cabinet-q') !== null) {
          state.cabinetQ = String(t.value || '');
          renderCabinet();
          return;
        }
        var labelIdx = t.getAttribute('data-tier-label');
        var minIdx = t.getAttribute('data-tier-min');
        var maxIdx = t.getAttribute('data-tier-max');
        if (labelIdx !== null || minIdx !== null || maxIdx !== null) {
          state.tierDraft = state.tierDraft || [];
          var i = parseInt(labelIdx !== null ? labelIdx : (minIdx !== null ? minIdx : maxIdx), 10);
          state.tierDraft[i] = state.tierDraft[i] || { label: '', min: '', max: '' };
          if (labelIdx !== null) state.tierDraft[i].label = t.value;
          if (minIdx !== null) state.tierDraft[i].min = t.value;
          if (maxIdx !== null) state.tierDraft[i].max = t.value;
        }
      });

      // 「我的材料」输入框：回车提交
      doc.addEventListener('keydown', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        if (t.getAttribute('data-pantry-input') === null) return;
        var enter = e.key === 'Enter' || e.keyCode === 13;
        if (!enter) return;
        if (e.preventDefault) e.preventDefault();
        addPantryFromDraft();
      });

      // 手机上软键盘收起会挤压视口，手指离手时按钮可能已经移走，click 就被吞掉了。
      // 「＋」在 touchstart 阶段就处理，不让这一次点击白费。
      doc.addEventListener('touchstart', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-act="addPantry"]') : null;
        if (!el) return;
        if (e.preventDefault) e.preventDefault();   // 阻止随后再补一次 click，避免加两遍
        handleAction('addPantry', el);
      }, { passive: false });

      // 筛选条横向胶囊：桌面端滚轮转横向滚动（触屏本来就支持手势）
      doc.addEventListener('wheel', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('.chips.scroll') : null;
        if (!el) return;
        var overflow = (el.scrollWidth || 0) - (el.clientWidth || 0);
        if (overflow <= 0) return;
        var d = e.deltaY || e.deltaX || 0;
        if (!d) return;
        if (e.preventDefault) e.preventDefault();
        el.scrollLeft = Math.max(0, Math.min(overflow, (el.scrollLeft || 0) + d));
      });

      doc.getElementById('btnSettings').addEventListener('click', function () {
        handleAction('settings', null);
      });

      win.addEventListener('hashchange', onHashChange);
    }

    function start() {
      // 盲盒档位默认全选：null 表示还没动过，「取消勾选的档位不参与抽取」。
      state.blind.tierIds = null;
      migratePantry();          // 先把历史遗留的脏材料标签（整串那种）拆干净
      bindEvents();
      applyTheme();
      checkBackupReminder();    // 距上次备份超过 30 天给个轻提示
      if (!win.location.hash) win.location.hash = '#/recommend';
      onHashChange();
    }

    /* 暗色主题：把值写回 <html data-theme>，样式层用 CSS 变量切换 */
    function applyTheme() {
      try {
        var root = doc.documentElement || doc.body;
        if (root && root.setAttribute) root.setAttribute('data-theme', store.getTheme());
      } catch (e) { /* 假 DOM 忽略 */ }
    }

    /* 距上次导出备份超过 30 天 → 轻量提醒一次（不阻断） */
    function checkBackupReminder() {
      var last = store.getLastBackup();
      if (!last) return;                       // 从没导出过，不打扰
      var days = (now() - last) / 86400000;
      if (days >= 30) {
        toast('建议导出备份你的酒柜与自制配方，防止清理缓存丢失数据');
      }
    }

    return {
      state: state,
      start: start,
      render: render,
      handleAction: handleAction,
      applyImport: applyImport,
      saveRecipe: saveRecipe,
      saveTiers: saveTiers,
      blindDraw: blindDraw,
      exportBackup: exportBackup,
      onHashChange: onHashChange,
      back: back,
      closeOverlay: closeOverlay,
      tiers: tiers,
      toast: toast
    };
  }

  var api = { createApp: createApp };
  globalThis.RJApp = api;

  // 浏览器环境自动启动（Node 测试中不自动启动）
  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    var boot = function () {
      var app = createApp({
        doc: document,
        win: window,
        store: globalThis.RJStore.createStore(),
        core: globalThis.RJCore,
        ui: globalThis.RJUI,
        tags: globalThis.RJTags
      });
      globalThis.__rj = app;
      app.start();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
