/* 应用装配层：路由渲染 + 事件绑定（依赖注入，便于在假 DOM 中测试） */
(function (global) {
  'use strict';

  var PAGE_TITLE = { recommend: '推荐', cabinet: '酒柜', box: '盲盒', mixer: '兑酒', drink: '详情' };
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

    function closeOverlay() {
      state.overlay = null;
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
      if (state.q) out = rankByQuery(out, state.q);
      return out;
    }

    /* 搜索时按命中 token 数降序排（稳定排序，同分保持洗牌顺序）：
       逐字 OR 匹配很宽松，把「命中字更多」的排前面才可用 */
    function rankByQuery(list, q) {
      var tokens = core.queryTokens(q);
      if (!tokens.length) return list;
      return list.map(function (d, idx) {
        var hay = [d.name, d.name_zh, d.name_display, d.category, d.glass]
          .concat(d.ingredients_zh || []).concat(d.ingredients_en || []).join(' ').toLowerCase();
        var hit = 0;
        for (var i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) !== -1) hit++;
        }
        return { d: d, hit: hit, idx: idx };
      }).sort(function (a, b) {
        return b.hit - a.hit || a.idx - b.idx;
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

    function renderRecommend() {
      var parts = recommendParts();
      state.lastTotal = parts.total;
      var html = ui.filterBarHtml({
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

    /* 把推荐页筛选条件写回 URL：
       进详情再返回时能回到原来的筛选，而不是丢掉。
       用 replaceState 不新增历史记录（file:// 下被拒时退回直接改 hash）。 */
    function syncHash() {
      if (state.route.page !== 'recommend' || !win.location) return;
      var hash = core.buildHash({
        page: 'recommend',
        q: {
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

    /* 酒柜页：我的材料 → 能做的酒 → 我的酒柜 → 喝过的酒 */
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
        ready: groups.ready,
        near: groups.near,
        cabinet: cabinet,
        rated: rated,
        history: history
      }, tags);
    }

    /* 兑酒专区：主库里 id 以 cn- 开头的配方 */
    function renderMixer() {
      var list = store.allRecipes().filter(function (d) {
        return String(d.id || '').indexOf('cn-') === 0;
      });
      view().innerHTML = ui.mixerHtml({ list: list }, tags);
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
        tierIds: state.blind.tierIds,
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
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var act = t.getAttribute('data-tab') === page || (page === 'drink' && t.getAttribute('data-tab') === 'recommend');
        if (act) t.className = 'tab active';
        else t.className = 'tab';
      }
      if (page === 'recommend') renderRecommend();
      else if (page === 'cabinet') renderCabinet();
      else if (page === 'box') renderBox();
      else if (page === 'mixer') renderMixer();
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
        && (r.q.strength || '') === state.strength;
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
        resetRecommendList();
        closeOverlay();
        render();
        toast(mode === 'replace'
          ? '已覆盖导入（' + res.cabinet + ' 瓶酒柜 / ' + res.custom + ' 自制）'
          : '已合并导入（' + res.cabinet + ' 瓶酒柜 / ' + res.custom + ' 自制）');
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
      for (var i = 0; i < draft.length; i++) {
        var t = draft[i];
        var label = String(t.label || '').trim();
        if (!label) continue;
        var min = Number(t.min);
        var max = t.max === '' || t.max === null || t.max === undefined ? Infinity : Number(t.max);
        if (!isFinite(min)) min = 0;
        if (Number.isNaN(max)) max = Infinity;
        clean.push({ label: label, min: min, max: max });
      }
      if (clean.length < 1) return tierFail('至少保留一个档位');
      for (var j = 0; j < clean.length; j++) {
        if (clean[j].max <= clean[j].min) {
          return tierFail('「' + clean[j].label + '」的最高价必须大于最低价');
        }
      }
      store.setPriceTiers(clean);
      state.tierErr = '';
      state.blind.tierIds = tags.normalizeTiers(clean).map(function (t) { return t.id; });
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
        case 'delPantry':
          store.removePantry(el.getAttribute('data-val'));
          renderCabinet();
          break;
        case 'delHistory':
          store.removeHistory(el.getAttribute('data-val'));
          renderCabinet();
          break;
        case 'clearHistory':
          if (win.confirm && win.confirm('清空全部浏览历史？')) {
            store.clearHistory();
            renderCabinet();
            toast('浏览历史已清空');
          }
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
          if (win.confirm && win.confirm('确定清空酒柜与自制配方吗？建议先导出备份。')) {
            store.clearAll();
            state.blind.result = null;
            state.blind.tierIds = tiers().map(function (t) { return t.id; });
            resetRecommendList();
            closeOverlay();
            render();
            toast('已清空全部数据');
          }
          break;
        case 'delCustom':
          if (win.confirm && win.confirm('删除这个自制配方？')) {
            store.removeCustom(id);
            resetRecommendList();
            navigate('#/recommend');
            render();
            toast('已删除');
          }
          break;
        default:
          break;
      }
      return undefined;
    }

    /* 提交「我的材料」输入框里的内容（回车 / 点＋时调用） */
    function addPantryFromDraft() {
      var raw = String(state.pantryDraft || '').trim();
      if (!raw) return false;
      var name = tags.ingredientName(raw);
      if (!name) return false;
      var added;
      try { added = store.addPantry(name); } catch (e) { return false; }
      state.pantryDraft = '';
      renderCabinet();
      var inp = doc.getElementById('pantryInput');
      if (inp) {
        if (inp.focus) inp.focus();
        if (inp.setSelectionRange) {
          try { inp.setSelectionRange(0, 0); } catch (err) { /* 某些 input 类型不支持 */ }
        }
      }
      if (added) toast('已加入材料：' + name);
      return added;
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

      // 推荐页滑到底自动加载更多（滚动容器是 #view，元素本身不会被替换）
      var viewEl = doc.getElementById('view');
      if (viewEl && viewEl.addEventListener) {
        viewEl.addEventListener('scroll', onViewScroll, { passive: true });
      }

      // 表单/档位输入：事件委托，避免整页重渲染丢焦点
      doc.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        // 「我的材料」输入框：打字阶段只记草稿，不重渲染（否则会丢焦点）
        if (t.getAttribute('data-pantry-input') !== null) {
          state.pantryDraft = String(t.value || '');
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
      // 盲盒档位初始 = 全选
      state.blind.tierIds = tiers().map(function (t) { return t.id; });
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
