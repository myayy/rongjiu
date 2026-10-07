/* 应用装配层：路由渲染 + 事件绑定（依赖注入，便于在假 DOM 中测试） */
(function (global) {
  'use strict';

  var PAGE_TITLE = { recommend: '推荐', cabinet: '酒柜', box: '盲盒', drink: '详情' };
  var PAGE_SIZE = 30;

  function createApp(deps) {
    var doc = deps.doc;
    var win = deps.win;
    var store = deps.store;
    var core = deps.core;
    var ui = deps.ui;
    var tags = deps.tags;

    var state = {
      route: { page: 'recommend', id: null, q: {} },
      q: '',
      category: '',
      alcoholic: '',
      page: 1,
      blind: { tierIds: [], tastes: [], alcoholic: '', result: null, lastId: null },
      tierDraft: null,
      recipeDraft: null,
      overlay: null,
      pool: []
    };

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
      return { q: state.q, category: state.category, alcoholic: state.alcoholic };
    }

    function filteredList() {
      return core.filterRecipes(store.allRecipes(), currentFilters());
    }

    function recommendParts() {
      var list = filteredList();
      var shown = core.pageSlice(list, state.page, PAGE_SIZE);
      var opts = ui_lastRecommendOpts(list);
      return {
        listBox: ui.cardListHtml(shown, opts, tags),
        footer: shown.length < list.length
          ? '<button class="load-more" data-act="loadMore">继续加载（已显示 ' + shown.length + ' / ' + list.length + '）</button>'
          : (list.length ? '<div class="more-hint">— 已到底，共 ' + list.length + ' 款 —</div>' : '')
      };
    }

    function renderRecommend() {
      var cats = core.uniqueCategories(store.allRecipes());
      var parts = recommendParts();
      var html = ui.filterBarHtml({ q: state.q, category: state.category, alcoholic: state.alcoholic }, cats)
        + '<div id="listBox">' + parts.listBox + '</div>' + parts.footer;
      view().innerHTML = html;
      // 同步 listBox（Node 假 DOM 中与 view 分离；真实 DOM 中为幂等）
      var lb = doc.getElementById('listBox');
      if (lb && lb !== view()) lb.innerHTML = parts.listBox;
      bindSearch();
    }

    function bindSearch() {
      var input = doc.getElementById('searchInput');
      if (!input || input.__rjBound) return;
      input.__rjBound = true;
      input.addEventListener('input', function (e) {
        state.q = e.target.value;
        state.page = 1;
        var pos = typeof e.target.selectionStart === 'number' ? e.target.selectionStart : null;
        renderRecommend();
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
      return { empty: {
        ico: '🔍',
        text: list.length === 0 ? '未找到相关配方，换个关键词或清除筛选试试' : '配方库为空',
        action: (state.q || state.category || state.alcoholic) ? { act: 'clearFilter', label: '清除筛选' } : null
      } };
    }

    function renderCabinet() {
      var ids = store.getCabinet();
      var items = ids.map(function (id) { return store.findRecipe(id); }).filter(Boolean);
      var html;
      if (!items.length) {
        html = ui.emptyHtml({
          ico: '🗄',
          text: '酒柜还空着。去推荐页或盲盒看到想喝的，点「加入酒柜」就存这儿了。',
          action: { act: 'gotoRecommend', label: '去逛逛' }
        });
      } else {
        html = '<div class="more-hint">共 ' + items.length + ' 瓶</div>'
          + items.map(function (d) {
            return ui.cardHtml(d, { inCabinet: true }, tags);
          }).join('');
      }
      view().innerHTML = html;
    }

    function renderDetail(id) {
      var d = store.findRecipe(id);
      if (!d) {
        view().innerHTML = ui.emptyHtml({
          ico: '🤔', text: '找不到这个配方', action: { act: 'gotoRecommend', label: '回到推荐' }
        });
        return;
      }
      view().innerHTML = ui.detailHtml(d, { inCabinet: store.isInCabinet(d.id), customTiers: store.getPriceTiers() }, tags);
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
      else if (page === 'drink') renderDrink();
      renderOverlay();
    }

    function renderOverlay() {
      var ov = doc.getElementById('overlay');
      if (!ov) return;
      if (!state.overlay) { ov.className = 'overlay hidden'; ov.innerHTML = ''; return; }
      ov.className = 'overlay';
      var kind = state.overlay;
      if (kind === 'settings') ov.innerHTML = ui.settingsHtml({ tierCount: tiers().length });
      else if (kind === 'newRecipe') ov.innerHTML = ui.addFormHtml();
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
      state.route = r;
      if (r.page === 'recommend') {
        state.q = r.q.q || '';
        state.category = r.q.category || '';
        state.alcoholic = r.q.alcoholic || '';
        state.page = parseInt(r.q.page, 10) || 1;
      }
      if (r.page !== 'box') { state.blind.result = state.blind.result; }
      render();
      if (view()) view().scrollTop = 0;
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
        step: val('fStep').trim()
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
          instructions_zh: d.step
        });
      } catch (e) {
        return fail(e.message);
      }
      closeOverlay();
      state.q = '';
      state.category = '';
      state.alcoholic = '';
      state.page = 1;
      navigate(core.buildHash({ page: 'recommend', q: {} }));
      render();
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
        case 'cat':
          state.category = state.category === el.getAttribute('data-val') ? '' : el.getAttribute('data-val');
          state.page = 1;
          render();
          break;
        case 'alc':
          state.alcoholic = el.getAttribute('data-val');
          state.page = 1;
          render();
          break;
        case 'clearFilter':
          state.q = ''; state.category = ''; state.alcoholic = ''; state.page = 1;
          render();
          break;
        case 'loadMore':
          state.page += 1;
          renderRecommend();
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
            closeOverlay();
            render();
            toast('已清空全部数据');
          }
          break;
        case 'delCustom':
          if (win.confirm && win.confirm('删除这个自制配方？')) {
            store.removeCustom(id);
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

      // 表单/档位输入：事件委托，避免整页重渲染丢焦点
      doc.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
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
