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
      blind: { tierIds: [], tastes: [], alcoholic: '', result: null, lastId: null },
      tierDraft: null,
      recipeDraft: null,
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
      else if (sec && sec !== 'all') out = out.filter(function (d) { return tags.sectionOf(d) === sec; });
      if (state.q) out = rankByQuery(out, state.q);
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

    /* 推荐页两种形态：
       ① 没筛选、也没进分区 → 货架首页（横向分区，像视频网站那样左右滑）
       ② 有搜索/筛选，或从「全部 ›」进了某个分区 → 纵向列表 */
    function renderRecommend() {
      if (!currentSec() && !hasFilter()) { renderShelf(); return; }
      var parts = recommendParts();
      state.lastTotal = parts.total;
      var sec = currentSec();
      var html = (sec ? ui.sectionHeadHtml(tags.sectionById(sec), parts.total) : '')
        + ui.filterBarHtml({
          q: state.q,
          tastes: state.tastes,
          ingredients: state.ingredients,
          strength: state.strength
        }, tags.commonIngredients(store.allRecipes(), ING_CHIPS), tags)
        + '<div id="listBox">' + parts.listBox + '</div>' + parts.footer;
      view().innerHTML = html;
      // 同步 listBox（Node 假 DOM 中与 view 分离；真实 DOM 中为幂等）
      var lb = doc.getElementById('listBox');
      if (lb && lb !== view()) lb.innerHTML = parts.listBox;
      bindSearch();
      syncHash();
      // 注意：这里不要动 scrollTop —— 「加载更多」必须保持当前位置
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
      view().innerHTML = ui.searchOnlyHtml(state.q)
        + ui.allEntryHtml(store.allRecipes().length)
        + ui.shelfHtml(sections, tags, 12);
      bindSearch();
      // 清空搜索等场景会落回货架首页，这里要把 URL 一并复位，别留着旧的 ?q=
      syncHash();
    }

    /* 把推荐页筛选条件写回 URL：
       进详情再返回时能回到原来的筛选，而不是丢掉。
       用 replaceState 不新增历史记录（file:// 下被拒时退回直接改 hash）。 */
    function syncHash() {
      if (state.route.page !== 'recommend' || !win.location) return;
      var hash = core.buildHash({
        page: 'recommend',
        q: {
          sec: currentSec(),
          q: state.q,
          tastes: state.tastes.join(','),
          ingredients: state.ingredients.join(','),
          strength: state.strength
        }
      });
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
        state.q = e.target.value;
        state.shown = PAGE_SIZE;
        state.restoreScroll = false;
        state.scrollMemo = 0;
        var pos = typeof e.target.selectionStart === 'number' ? e.target.selectionStart : null;
        renderRecommend();
        if (view()) view().scrollTop = 0;
        var again = doc.getElementById('searchInput');
        if (again) {
          if (again.focus) again.focus();
          if (pos !== null && again.setSelectionRange) {
            try { again.setSelectionRange(pos, pos); } catch (err) { /* number input 不支持 */ }
          }
        }
      });
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

    function recomputePool() {
      state.pool = core.buildBlindPool(store.allRecipes(), {
        // 一个档位都没选 = 不限价格（core 里 [] 表示「没有一档符合」，所以这里传 null 跳过价格过滤）
        tierIds: state.blind.tierIds.length ? state.blind.tierIds : null,
        tastes: state.blind.tastes,
        alcoholic: state.blind.alcoholic,
        customTiers: store.getPriceTiers()
      }, tags);
    }

    function renderBox() {
      recomputePool();
      view().innerHTML = ui.blindHtml({
        pool: state.pool,
        tierIds: state.blind.tierIds,
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
      if (kind === 'settings') ov.innerHTML = ui.settingsHtml({ tierCount: tiers().length });
      else if (kind === 'newRecipe') { ov.innerHTML = ui.addFormHtml(); bindRecipeImageInput(); }
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
        && (r.q.sec || '') === currentSec();
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
      try {
        var rec = store.addCustom({
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
      } catch (e) {
        return fail(e.message);
      }
      closeOverlay();
      state.q = '';
      state.tastes = [];
      state.ingredients = [];
      state.strength = '';
      resetRecommendList();
      navigate(core.buildHash({ page: 'recommend', q: {} }));
      render();
      if (view()) view().scrollTop = 0;
      toast('已保存：' + rec.name_display);
      return { ok: true, record: rec };
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
      state.blind.tierIds = [];   // 档位改了，旧的选中 id 已失效；默认回到「不限」
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
          state.seed = Math.floor(nextRandom() * 0x7fffffff);
          resetRecommendList();
          renderRecommend();
          if (view()) view().scrollTop = 0;
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
        case 'gotoRecommend':
          navigate('#/recommend');
          break;
        case 'moreSection': {
          // 从货架点「全部 ›」进某个分区的完整列表
          navigate(core.buildHash({ page: 'recommend', q: { sec: el.getAttribute('data-val') } }));
          break;
        }
        case 'backShelf':
          // 从分区列表回货架首页：顺手清掉筛选，保证落回首页形态
          state.q = ''; state.tastes = []; state.ingredients = []; state.strength = '';
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
          var arr = state.blind.tierIds;
          var k = arr.indexOf(tid);
          if (k === -1) arr.push(tid); else arr.splice(k, 1);
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
        case 'importReplace': {
          var mode = act === 'importMerge' ? 'merge' : 'replace';
          pickFile(function (text, err) {
            if (err) { var e = doc.getElementById('importErr'); if (e) e.textContent = err; return; }
            applyImport(text, mode);
          });
          break;
        }
        case 'clearAll':
          openConfirm({
            title: '清空全部数据？',
            text: '酒柜、自制配方、我的材料、评分和浏览历史都会被删除，且无法恢复。建议先导出备份。',
            okLabel: '确定清空',
            danger: true,
            run: function () {
              store.clearAll();
              state.blind.result = null;
              state.blind.tierIds = [];
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
      var names = tags.splitIngredients(state.pantryDraft);
      if (!names.length) return false;
      var added = [];
      names.forEach(function (n) {
        try { if (store.addPantry(n)) added.push(n); } catch (e) { /* 单个失败不影响其余 */ }
      });
      state.pantryDraft = '';
      renderCabinet();
      var inp = doc.getElementById('pantryInput');
      if (inp) {
        if (inp.focus) inp.focus();
        if (inp.setSelectionRange) {
          try { inp.setSelectionRange(0, 0); } catch (err) { /* 某些 input 类型不支持 */ }
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
      // 盲盒档位初始 = 不限（一个都不选）。点一下才是「只看这一档」，
      // 和界面提示「点选一个或多个档位，不选=不限」保持一致。
      state.blind.tierIds = [];
      migratePantry();          // 先把历史遗留的脏材料标签（整串那种）拆干净
      bindEvents();
      if (!win.location.hash) win.location.hash = '#/recommend';
      onHashChange();
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
