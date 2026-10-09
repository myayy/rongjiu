/* 渲染层：纯函数输出 HTML 字符串（不触碰 DOM，可在 Node 中测试） */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function imageHtml(drink, cls) {
    if (drink.image) {
      return '<img class="' + cls + '" src="' + esc(drink.image) + '" alt="' + esc(drink.name_display) + '" loading="lazy">';
    }
    return '<div class="' + cls + ' placeholder">🍸</div>';
  }

  function isCustom(drink) {
    return String(drink.id || '').indexOf('my-') === 0;
  }

  /* 星级只认 1~5 的整数，其余一律当「未评价」 */
  function normRating(v) {
    var n = Number(v);
    if (!isFinite(n) || n % 1 !== 0 || n < 1 || n > 5) return 0;
    return n;
  }

  /* 五星控件（详情页 / 喝过的酒列表共用） */
  function rateStarsHtml(id, rating) {
    var r = normRating(rating);
    var s = '';
    for (var i = 1; i <= 5; i++) {
      s += '<button class="star' + (i <= r ? ' on' : '') + '" data-act="rate" data-id="' + esc(id)
        + '" data-val="' + i + '" aria-label="' + i + ' 星">★</button>';
    }
    return '<div class="rate-row">' + s
      + '<span class="rate-txt">' + (r ? '已喝过 ★' + r : '未评价') + '</span></div>';
  }

  function priceOf(drink, tagsApi) {
    return tagsApi.estimatePrice(drink);
  }

  /* 卡片上的口味摘要：最多显示 2 个，更多用「+N」表示 */
  function tasteSummary(tastes) {
    if (!tastes || !tastes.length) return '';
    var head = tastes.slice(0, 2).join(' · ');
    return tastes.length > 2 ? head + ' +' + (tastes.length - 2) : head;
  }

  function cardHtml(drink, opts, tagsApi) {
    opts = opts || {};
    var inCab = !!opts.inCabinet;
    var tastes = tagsApi.deriveTastes(drink);
    var price = priceOf(drink, tagsApi);
    var catText = tagsApi.categoryLabel(drink.category) || '未分类';
    var alcText = tagsApi.alcoholLabel(drink.alcoholic);
    var nonAlc = tagsApi.isNonAlcoholic(drink);
    var chips = '<span class="chip">' + esc(catText) + '</span>';
    if (alcText) chips += '<span class="chip ' + (nonAlc ? 'green' : 'accent') + '">' + esc(alcText) + '</span>';
    chips += '<span class="chip">' + price + '元</span>';
    chips += '<span class="chip">' + esc(tasteSummary(tastes)) + '</span>';
    if (isCustom(drink)) chips += '<span class="chip accent">自制</span>';
    var rating = normRating(opts.rating !== undefined && opts.rating !== null
      ? opts.rating
      : (opts.ratings ? opts.ratings[drink.id] : 0));
    if (rating) chips += '<span class="chip accent">已喝过 ★' + rating + '</span>';
    if (opts.missing) chips += '<span class="chip">还差 ' + esc(opts.missing) + '</span>';

    var heart = opts.compact ? '' :
      '<div class="card-actions"><button class="heart' + (inCab ? ' on' : '') + '" data-act="toggle" data-id="'
      + esc(drink.id) + '">' + (inCab ? '✓ 已在酒柜' : '＋ 加入酒柜') + '</button></div>';

    var edit = isCustom(drink)
      ? '<button class="card-edit" data-act="editCustom" data-id="' + esc(drink.id) + '" title="编辑这条自制配方" aria-label="编辑">✎</button>'
      : '';

    return '<div class="card" data-act="open" data-id="' + esc(drink.id) + '">'
      + imageHtml(drink, 'card-img')
      + edit
      + '<div class="card-body"><div class="card-title">' + esc(drink.name_display) + '</div>'
      + '<div class="card-meta">' + chips + '</div>' + heart
      + '</div></div>';
  }

  function cardListHtml(drinks, opts, tagsApi) {
    if (!drinks.length) return emptyHtml(opts.empty || {});
    return drinks.map(function (d) { return cardHtml(d, opts, tagsApi); }).join('');
  }

  /* ---- 推荐页货架（横向分区，像视频网站首页那样左右滑） ---- */
  function shelfCardHtml(drink, tagsApi) {
    var alc = tagsApi.alcoholLabel(drink.alcoholic);
    var price = priceOf(drink, tagsApi);
    var edit = isCustom(drink)
      ? '<button class="card-edit" data-act="editCustom" data-id="' + esc(drink.id) + '" title="编辑这条自制配方" aria-label="编辑">✎</button>'
      : '';
    return '<div class="shelf-card" data-act="open" data-id="' + esc(drink.id) + '">'
      + '<div class="shelf-imgbox">' + imageHtml(drink, 'shelf-img') + edit + '</div>'
      + '<div class="shelf-name">' + esc(drink.name_display) + '</div>'
      + '<div class="shelf-meta">' + esc(alc || '') + (alc ? ' · ' : '') + price + '元</div>'
      + '</div>';
  }

  function shelfHtml(sections, tagsApi, limit) {
    var n = limit || 12;
    return (sections || []).map(function (s) {
      var more = s.drinks.length > n
        ? '<button class="shelf-more" data-act="moreSection" data-val="' + esc(s.id) + '">全部 ' + s.drinks.length + ' ›</button>'
        : '';
      return '<section class="shelf">'
        + '<div class="shelf-head">'
        + '<div class="shelf-title"><h3>' + esc(s.label) + '</h3>'
        + (s.hint ? '<span class="shelf-hint">' + esc(s.hint) + '</span>' : '')
        + '</div>' + more + '</div>'
        + '<div class="shelf-row">'
        + s.drinks.slice(0, n).map(function (d) { return shelfCardHtml(d, tagsApi); }).join('')
        + '</div></section>';
    }).join('');
  }

  /* ---- 分区列表页头部（分区名 + 返回全部） ---- */
  function sectionHeadHtml(section, count) {
    if (!section) return '';
    return '<div class="sec-head">'
      + '<button class="back-btn" data-act="backShelf">← 全部</button>'
      + '<div class="sec-title"><h3>' + esc(section.label) + '</h3>'
      + (section.hint ? '<span class="shelf-hint">' + esc(section.hint) + '</span>' : '')
      + '<span class="sec-count">' + count + ' 款</span></div>'
      + '</div>';
  }

  function emptyHtml(o) {
    o = o || {};
    return '<div class="empty"><span class="empty-ico">' + (o.ico || '🕳') + '</span>'
      + '<p>' + esc(o.text || '这里空空如也') + '</p>'
      + (o.action ? '<button class="btn ghost" data-act="' + esc(o.action.act) + '">' + esc(o.action.label) + '</button>' : '')
      + '</div>';
  }

  function detailHtml(drink, opts, tagsApi) {
    opts = opts || {};
    var tastes = tagsApi.deriveTastes(drink);
    var price = priceOf(drink, tagsApi);
    var tier = tagsApi.tierOf(price, tagsApi.normalizeTiers(opts.customTiers));

    var catText = tagsApi.categoryLabel(drink.category) || '未分类';
    var alcText = tagsApi.alcoholLabel(drink.alcoholic);
    var glassText = tagsApi.glassLabel(drink.glass);
    var nonAlc = tagsApi.isNonAlcoholic(drink);
    var kv = '<span class="chip">' + esc(catText) + '</span>'
      + (alcText ? '<span class="chip ' + (nonAlc ? 'green' : 'accent') + '">' + esc(alcText) + '</span>' : '')
      + (glassText ? '<span class="chip">' + esc(glassText) + '</span>' : '')
      + '<span class="chip">约 ' + price + '元' + (tier ? ' · ' + esc(tier.label) : '') + '</span>'
      + tastes.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');

    var ings = (drink.ingredients_zh || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');

    var cabBtn = opts.inCabinet
      ? '<button class="btn subtle" data-act="toggle" data-id="' + esc(drink.id) + '">✓ 已在酒柜 · 点击移除</button>'
      : '<button class="btn" data-act="toggle" data-id="' + esc(drink.id) + '">＋ 加入酒柜</button>';

    return '<button class="back-btn" data-act="back">← 返回</button>'
      + '<button class="share-btn" data-act="share" data-id="' + esc(drink.id) + '" title="分享这个配方" aria-label="分享">↗</button>'
      + '<div class="detail-hero">' + imageHtml(drink, 'detail-img') + '</div>'
      + '<div class="kv">' + kv + '</div>'
      + '<div class="btn-row">' + cabBtn
      + (isCustom(drink)
        ? '<button class="btn" data-act="editCustom" data-id="' + esc(drink.id) + '">✎ 编辑</button>'
          + '<button class="btn danger" data-act="delCustom" data-id="' + esc(drink.id) + '">删除</button>'
        : '')
      + '</div>'
      + '<div class="detail-section"><h3>配料</h3><ul>' + (ings || '<li>未填写</li>') + '</ul></div>'
      + '<div class="detail-section"><h3>做法</h3><p>' + esc(drink.instructions_zh || '未填写') + '</p></div>'
      + (drink.instructions_en ? '<div class="detail-section en-note"><h3>做法（英文原文）</h3><p>' + esc(drink.instructions_en) + '</p></div>' : '')
      + '<div class="detail-section"><h3>我的评价</h3>' + rateStarsHtml(drink.id, opts.rating) + '</div>';
  }

  function filterGroup(label, chips) {
    if (!chips) return '';
    return '<div class="fgroup"><div class="fgroup-label">' + esc(label) + '</div>'
      + '<div class="chips scroll">' + chips + '</div></div>';
  }

  function filterBarHtml(state, ingredients, tagsApi) {
    var myTastes = state.tastes || [];
    var tasteChips = tagsApi.ALL_TASTE_TAGS.map(function (t) {
      var on = myTastes.indexOf(t) !== -1;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-act="fTaste" data-val="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');

    var myIngs = state.ingredients || [];
    var ingChips = (ingredients || []).map(function (it) {
      var on = myIngs.indexOf(it.name) !== -1;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-act="fIng" data-val="' + esc(it.name) + '">' + esc(it.name) + '</button>';
    }).join('');

    var strChips = [{ id: '', label: '不限' }].concat(tagsApi.STRENGTHS).map(function (s) {
      var on = (state.strength || '') === s.id;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-act="fStr" data-val="' + esc(s.id) + '">' + esc(s.label) + '</button>';
    }).join('');

    var exactBtn = '<button class="exact-toggle' + (state.exact ? ' on' : '') + '" data-act="toggleExact" data-val="' + (state.exact ? '0' : '1') + '"'
      + ' title="精确匹配：只按酒名整串查找" aria-label="切换精确匹配">'
      + '<span class="exact-dot"></span>' + (state.exact ? '精确' : '模糊') + '</button>';

    return '<div class="filterbar">'
      + '<div class="search-row">'
      + '<input class="search" type="text" id="searchInput" placeholder="搜酒名 / 配料（任一字命中，直接输入材料即可筛）" value="' + esc(state.q || '') + '">'
      + exactBtn
      + '<button class="icon-btn refresh" data-act="refreshList" title="换一批" aria-label="换一批">🔄</button>'
      + '</div>'
      + filterGroup('口味', tasteChips)
      + filterGroup('材料', ingChips)
      + filterGroup('酒精强度', strChips)
      + '</div>';
  }

  /* 搜索历史胶囊：有词就点一下直接搜 */
  function searchHistoryHtml(items) {
    if (!items || !items.length) return '';
    return '<div id="searchHistory" class="hist-row">'
      + '<span class="hist-label">最近搜索</span>'
      + items.map(function (q) {
        return '<button class="fchip" data-act="searchHist" data-val="' + esc(q) + '">' + esc(q) + '</button>';
      }).join('')
      + '<button class="hist-clear" data-act="clearSearchHist" title="清空搜索历史">清空</button>'
      + '</div>';
  }

  /* ---- 列表底部：加载更多 / 已到底 ---- */
  function listFooterHtml(shown, total) {
    if (!total) return '';
    var atEnd = shown >= total;
    var cls = atEnd ? 'list-end' : 'list-more';
    var txt = atEnd
      ? (total > 30 ? '已到底 · 共 ' + total + ' 款' : '共 ' + total + ' 款')
      : '已显示 ' + shown + ' / ' + total;
    var btn = !atEnd
      ? '<button class="btn subtle more-btn" data-act="loadMore">加载更多</button>'
      : (total > 30 ? '<button class="btn ghost more-btn" data-act="refreshList">换一批</button>' : '');
    return '<div id="listMore" class="' + cls + '" data-shown="' + shown + '" data-total="' + total + '">'
      + '<div class="more-txt">' + txt + '</div>' + btn + '</div>';
  }

  /* ---- 我的材料 ---- */
  function pantryPanelHtml(pantry, draft, suggestNames) {
    var chips = (pantry || []).map(function (n) {
      return '<button class="fchip on" data-act="delPantry" data-val="' + esc(n) + '">' + esc(n) + ' ✕</button>';
    }).join('');
    return '<div class="box-panel">'
      + '<h3>我的材料</h3>'
      + '<p class="hint">输入家里现有的配料，帮你找出现在就能做的酒（冰块和水不用填）</p>'
      + '<div class="search-row">'
      + '<input class="search" type="text" id="pantryInput" data-pantry-input="1" placeholder="输入材料，可用 / 逗号一次填多个" value="' + esc(draft || '') + '">'
      + '<button class="icon-btn" data-act="addPantry" title="添加" aria-label="添加材料">＋</button>'
      + '</div>'
      + (chips ? '<div class="chips">' + chips + '</div>' : '')
      + '<div id="pantrySuggest">' + pantrySuggestHtml(suggestNames, draft) + '</div>'
      + '</div>';
  }

  /* 常见材料建议区：点一下直接加，省得猜库里管这材料叫什么 */
  function pantrySuggestHtml(names, keyword) {
    var kw = String(keyword == null ? '' : keyword).trim();
    var list = names || [];
    if (!list.length) {
      return '<div class="suggest-hint">库里没有含「' + esc(kw) + '」的材料，直接点「＋」也能添加</div>';
    }
    return '<div class="suggest-hint">' + (kw ? '匹配到的材料' : '常见材料') + '（点一下直接加）：</div>'
      + '<div class="chips">' + list.map(function (n) {
        return '<button class="fchip" data-act="addPantryName" data-val="' + esc(n) + '">＋ ' + esc(n) + '</button>';
      }).join('') + '</div>';
  }

  /* ---- 能做的酒 ---- */
  function makeableGroupHtml(label, items, tagsApi) {
    if (!items.length) return '';
    var limit = 20;
    var shown = items.slice(0, limit);
    return '<div class="fgroup-label">' + esc(label) + '（' + items.length + '）</div>'
      + shown.map(function (x) {
        return cardHtml(x.drink, { missing: x.missing, compact: true }, tagsApi);
      }).join('')
      + (items.length > limit ? '<div class="more-hint">仅显示前 ' + limit + ' 款，共 ' + items.length + ' 款</div>' : '');
  }

  function makeableHtml(ready, near, tagsApi, pantry) {
    var have = (pantry || []).join('、');
    var head = '<div class="box-panel"><h3>能做的酒</h3>'
      + '<p class="rulenote">仅展示「材料齐全」或只差 1 样材料的配方；缺 2 样及以上的不会在此显示</p>';
    // 一款都做不了时要说清楚，否则用户会以为点了「＋」没反应
    if (!ready.length && !near.length) {
      return head
        + '<p class="hint">按「' + esc(have) + '」暂时没有能做的酒。'
        + '这里只列「材料齐全」和「还差 1 样」的配方，差 2 样以上的不会出现；'
        + '再补几样基酒 / 糖浆 / 柠檬汁之类，结果就有了。</p></div>';
    }
    return head
      + (ready.length
        ? makeableGroupHtml('材料齐全', ready, tagsApi)
        : '<div class="fgroup-label">材料齐全（0）</div>'
          + '<p class="hint">手上的材料还凑不齐任何一款，先看下面「还差 1 样」的。</p>')
      + makeableGroupHtml('还差 1 样', near, tagsApi)
      + '</div>';
  }

  /* ---- 我的酒柜（支持搜索 + 按基酒分组 / 按收藏时间） ---- */
  function cabinetListHtml(items, tagsApi, opts) {
    opts = opts || {};
    var q = opts.q || '';
    var toolbar = '<div class="cab-tool">'
      + '<input class="search" type="text" id="cabinetQ" data-cabinet-q="1"'
      + ' placeholder="在酒柜里搜酒名 / 配料" value="' + esc(q) + '">'
      + '<div class="seg">'
      + '<button class="seg-btn' + (opts.mode === 'spirit' ? '' : ' on') + '" data-act="cabMode" data-val="time">按收藏时间</button>'
      + '<button class="seg-btn' + (opts.mode === 'spirit' ? ' on' : '') + '" data-act="cabMode" data-val="spirit">按基酒分组</button>'
      + '</div></div>';
    if (!items.length) {
      return '<div class="box-panel"><h3>我的酒柜</h3>' + toolbar
        + emptyHtml({
          ico: '🗄',
          text: q ? '酒柜里没有匹配「' + esc(q) + '」的配方' : '酒柜还空着。去推荐页或盲盒看到想喝的，点「加入酒柜」就存这儿了。',
          action: { act: 'gotoRecommend', label: '去逛逛' }
        })
        + '</div>';
    }
    var body;
    if (opts.mode === 'spirit') {
      // 按基酒分组：一款酒可能同时属多个基酒，用它在配方里命中的基酒名做小标题
      var groups = {};
      items.forEach(function (d) {
        var sps = tagsApi.spiritIdsOf(d);
        var label = sps.length ? tagsApi.SPIRITS.map(function (s) {
          return sps.indexOf(s.id) !== -1 ? s.label : null;
        }).filter(Boolean).join(' / ') : '未含基酒';
        (groups[label] = groups[label] || []).push(d);
      });
      var keys = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'zh'); });
      body = keys.map(function (k) {
        return '<div class="fgroup-label">' + esc(k) + '（' + groups[k].length + '）</div>'
          + groups[k].map(function (d) { return cardHtml(d, { inCabinet: true }, tagsApi); }).join('');
      }).join('');
    } else {
      body = items.map(function (d) { return cardHtml(d, { inCabinet: true }, tagsApi); }).join('');
    }
    return '<div class="box-panel"><h3>我的酒柜（' + items.length + ' 瓶）</h3>' + toolbar + body + '</div>';
  }

  /* ---- 喝过的酒（按星级降序） ---- */
  function ratedSectionHtml(rated, tagsApi) {
    if (!rated.length) return '';
    return '<div class="box-panel"><h3>喝过的酒（' + rated.length + '）</h3>'
      + rated.map(function (x) {
        return '<div class="rated-item">'
          + cardHtml(x.drink, { compact: true }, tagsApi)
          + rateStarsHtml(x.drink.id, x.rating)
          + '</div>';
      }).join('')
      + '</div>';
  }

  /* ---- 浏览历史入口（酒柜页底部，点击进独立页面） ---- */
  function historyEntryHtml(entries) {
    var n = (entries || []).length;
    return '<button class="entry-btn" data-act="gotoHistory">'
      + '<span class="entry-ico">🕘</span>'
      + '<span class="entry-label">浏览历史</span>'
      + '<span class="entry-val">' + (n ? n + ' 条' : '还没有记录') + '</span>'
      + '<span class="entry-arrow">›</span></button>';
  }

  /* ---- 浏览全部入口（放在搜索框下方，不用滑到底才找得到） ---- */
  function allEntryHtml(count) {
    return '<button class="entry-btn compact" data-act="moreSection" data-val="all">'
      + '<span class="entry-ico">📚</span>'
      + '<span class="entry-label">浏览全部配方</span>'
      + '<span class="entry-val">' + count + ' 款</span>'
      + '<span class="entry-arrow">›</span></button>';
  }

  /* ---- 浏览历史独立页 ---- */
  function historyPageHtml(entries, tagsApi) {
    var list = entries || [];
    var head = '<button class="back-btn" data-act="backToCabinet">← 返回酒柜</button>';
    if (!list.length) {
      return head + emptyHtml({
        ico: '🕘',
        text: '还没有浏览记录。去推荐页点几款酒看看，这里会记下你什么时候看过什么',
        action: { act: 'gotoRecommend', label: '去逛逛' }
      });
    }
    return head + '<div class="box-panel"><h3>浏览历史（' + list.length + '）</h3>'
      + '<div class="hist-head"><button class="hist-clear" data-act="clearHistory">清空历史</button></div>'
      + list.map(function (x) {
        return '<div class="hist-item">'
          + cardHtml(x.drink, { compact: true }, tagsApi)
          + '<div class="hist-foot"><span class="hist-time">' + esc(x.stamp || '') + '</span>'
          + '<button class="hist-del" data-act="delHistory" data-val="' + esc(x.drink.id) + '" title="删除这条记录">✕</button>'
          + '</div></div>';
      }).join('')
      + '<div class="more-hint">共 ' + list.length + ' 条，最多保留最近 100 条</div>'
      + '</div>';
  }

  /* ---- 酒柜页整体 ---- */
  function cabinetHtml(state, tagsApi) {
    var pantry = state.pantry || [];
    return pantryPanelHtml(pantry, state.pantryDraft, state.pantrySuggest)
      + (pantry.length ? makeableHtml(state.ready || [], state.near || [], tagsApi, pantry) : '')
      + cabinetListHtml(state.cabinet || [], tagsApi, {
        q: state.cabinetQ || '', mode: state.cabinetMode || 'time'
      })
      + ratedSectionHtml(state.rated || [], tagsApi)
      + historyEntryHtml(state.history || []);
  }

  /* ---- 盲盒 ---- */
  function blindHtml(state, tiers, tagsApi) {
    var tierChips = tiers.map(function (t) {
      var on = (state.tierIds || []).indexOf(t.id) !== -1;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-act="tier" data-val="' + esc(t.id) + '">' + esc(t.label) + '</button>';
    }).join('');
    var tasteChips = tagsApi.ALL_TASTE_TAGS.map(function (tg) {
      var on = (state.tastes || []).indexOf(tg) !== -1;
      return '<button class="fchip' + (on ? ' on' : '') + '" data-act="taste" data-val="' + esc(tg) + '">' + esc(tg) + '</button>';
    }).join('');
    var alc = [['', '不限'], ['yes', '含酒精'], ['no', '无酒精']].map(function (p) {
      return '<button class="fchip' + ((state.alcoholic || '') === p[0] ? ' on' : '') + '" data-act="alc" data-val="' + esc(p[0]) + '">' + p[1] + '</button>';
    }).join('');

    var pool = state.pool || [];
    var result = '';
    if (state.result) {
      result = '<div class="box-result">' + detailHtml(state.result, {
        inCabinet: state.resultInCabinet,
        customTiers: tiers
      }, tagsApi)
        + '<div class="btn-row"><button class="btn ghost" data-act="blindAgain">🎲 再来一次</button></div></div>';
    } else {
      result = emptyHtml({ ico: '🎁', text: pool.length ? '条件已就绪，点下面按钮抽一瓶' : '当前条件没有匹配的酒，试试放宽档位或口感' });
    }

    return '<div class="box-panel"><h3>价格档位</h3>'
      + '<p class="hint">默认全部勾选；<b>取消勾选的档位不会参与抽取</b></p>'
      + '<div class="chips">' + tierChips + '</div>'
      + '<button class="link-btn" data-act="tiers">⚙ 编辑价格档位</button>'
      + '</div>'
      + '<div class="box-panel"><h3>想要的口感</h3><p class="hint">命中任一所选标签即可入池</p>'
      + '<div class="chips">' + tasteChips + '</div></div>'
      + '<div class="box-panel"><h3>酒精</h3>'
      + '<div class="chips">' + alc + '</div></div>'
      + '<div class="box-count">符合条件：' + pool.length + ' 款</div>'
      + result
      + '<div class="btn-row"><button class="btn" data-act="blindDraw" ' + (pool.length ? '' : 'disabled') + '>🎯 抽一瓶</button></div>';
  }

  /* ---- 新增 / 编辑配方表单（draft 存在时用于编辑回填） ---- */
  function addFormHtml(draft) {
    draft = draft || {};
    var editing = !!draft.editId;
    var d = draft._source || {};
    var title = editing ? '编辑自制配方' : '新增配方';
    var imgPreview = d.image
      ? '<div id="fImgPreview" class="img-preview"><img src="' + esc(d.image) + '" alt="配方照片"></div>'
      : '<div id="fImgPreview" class="img-preview"></div>';
    return '<div class="sheet"><h2>' + title + '</h2><p class="sub">保存在本机浏览器，刷新不丢</p>'
      + '<div class="form">'
      + '<label>名称 *</label><input type="text" id="fName" placeholder="例如：融酒特调" value="' + esc(d.name_display || '') + '">'
      + '<label>分类</label><input type="text" id="fCategory" placeholder="例如：Cocktail / 自制" value="' + esc(d.category || '') + '">'
      + '<label>是否含酒精</label><select id="fAlc"><option value="Alcoholic"' + (d.alcoholic === 'Alcoholic' ? ' selected' : '') + '>含酒精</option>'
      + '<option value="Non alcoholic"' + (d.alcoholic === 'Non alcoholic' ? ' selected' : '') + '>无酒精</option></select>'
      + '<label>杯型</label><input type="text" id="fGlass" placeholder="例如：Highball glass" value="' + esc(d.glass || '') + '">'
      + '<label>配料 *（每行一条）</label><textarea id="fIng" placeholder="45毫升伏特加&#10;15毫升柠檬汁">' + esc((d.ingredients_zh || []).join('\n')) + '</textarea>'
      + '<label>做法</label><textarea id="fStep" placeholder="摇匀，滤入杯中。">' + esc(d.instructions_zh || '') + '</textarea>'
      + '<label>照片（可选）</label>'
      + '<div class="img-pick">'
      + '<input type="file" id="fImage" accept="image/*" data-recipe-img="1">'
      + '<label class="img-pick-btn" for="fImage">' + (d.image ? '更换照片' : '＋ 选择照片') + '</label>'
      + '<span class="img-pick-hint">自动压缩后存在本机</span>'
      + '</div>'
      + imgPreview
      + '<div class="err" id="fErr"></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">取消</button>'
      + '<button class="btn" data-act="saveRecipe">' + (editing ? '保存修改' : '保存') + '</button></div>'
      + '</div></div>';
  }

  /* ---- 详情/盲盒结果复用按钮行 ---- */
  function settingsHtml(opts) {
    opts = opts || {};
    var themeLabel = opts.theme === 'dark' ? '暗色' : '浅色';
    var themeToggle = opts.theme !== undefined && opts.theme !== null
      ? '<div class="menu-item" data-act="toggleTheme"><span>' + (opts.theme === 'dark' ? '🌙 暗色模式' : '☀️ 浅色模式') + '</span><span class="val">切换为' + (opts.theme === 'dark' ? '浅色' : '暗色') + '</span></div>'
      : '';
    return '<div class="sheet"><h2>设置</h2><p class="sub">数据仅保存在本机浏览器</p>'
      + '<div class="menu-item" data-act="newRecipe"><span>＋ 新增配方</span><span class="val">自制入库</span></div>'
      + '<div class="menu-item" data-act="export"><span>⬇ 导出备份</span><span class="val">JSON 文件</span></div>'
      + '<div class="menu-item" data-act="import"><span>⬆ 导入备份</span><span class="val">合并 / 覆盖</span></div>'
      + '<div class="menu-item" data-act="tiers"><span>¥ 价格档位</span><span class="val">' + (opts.tierCount || 3) + ' 档 · 可自定义</span></div>'
      + themeToggle
      + '<div class="menu-item" data-act="about"><span>ⓘ 关于</span><span class="val"></span></div>'
      + '<div class="menu-item danger" data-act="clearAll"><span>🗑 清空全部数据</span><span class="val">含酒柜 / 自制 / 材料 / 评分 / 历史</span></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">关闭</button></div>'
      + '</div>';
  }

  function tiersHtml(tiers, err) {
    var rows = tiers.map(function (t, i) {
      return '<div class="tier-row">'
        + '<input type="text" class="tier-label" data-tier-label="' + i + '" value="' + esc(t.label) + '" placeholder="档位名">'
        + '<input type="number" data-tier-min="' + i + '" value="' + esc(t.min) + '" placeholder="最低">'
        + '<input type="number" data-tier-max="' + i + '" value="' + (t.max === Infinity || t.max === null ? '' : esc(t.max)) + '" placeholder="最高">'
        + '<button class="del" data-act="delTier" data-idx="' + i + '">✕</button>'
        + '</div>';
    }).join('');
    return '<div class="sheet"><h2>价格档位</h2><p class="sub">自定义盲盒的价格分档，最高档留空表示不限</p>'
      + '<div id="tierList">' + rows + '</div>'
      + '<div class="err" id="tierErr">' + esc(err || '') + '</div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="addTier">＋ 加一档</button>'
      + '<button class="btn subtle" data-act="resetTiers">恢复默认</button></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">取消</button>'
      + '<button class="btn" data-act="saveTiers">保存</button></div>'
      + '</div>';
  }

  function aboutHtml() {
    return '<div class="sheet about"><h2>关于 · 融酒</h2>'
      + '<p>纯本地运行的调酒助手：不联网、不登录、数据只存在本机浏览器里。刷新、关闭、重启都不丢；建议定期「导出备份」。</p>'
      + '<p>价格为规则估算，仅供盲盒分档参考；配料用量已统一换算成公制中文（如「60 毫升」），括号内保留原文对照备查。</p>'
      + '<p>仅限个人本地自用。</p>'
      + '<div class="btn-row"><button class="btn" data-act="closeOverlay">知道了</button></div></div>';
  }

  /* 应用内确认弹层（替代原生 confirm：内置浏览器/被拦截时原生弹窗会静默失效） */
  function confirmHtml(o) {
    o = o || {};
    return '<div class="sheet confirm"><h2>' + esc(o.title || '请确认') + '</h2>'
      + (o.text ? '<p>' + esc(o.text) + '</p>' : '')
      + '<div class="btn-row"><button class="btn subtle" data-act="confirmNo">' + esc(o.cancelLabel || '取消') + '</button>'
      + '<button class="btn' + (o.danger ? ' danger' : '') + '" data-act="confirmYes">' + esc(o.okLabel || '确定') + '</button></div>'
      + '</div>';
  }

  function importHtml() {
    return '<div class="sheet"><h2>导入备份</h2><p class="sub">选择 .json 备份文件</p>'
      + '<div class="btn-row">'
      + '<button class="btn" data-act="importMerge">合并导入</button>'
      + '<button class="btn danger" data-act="importReplace">覆盖导入</button>'
      + '</div>'
      + '<div class="err" id="importErr"></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">取消</button></div></div>';
  }

  /* 分享弹层：文本复制 / 生成长图 */
  function shareHtml(name) {
    return '<div class="sheet"><h2>分享 · ' + esc(name) + '</h2><p class="sub">把这条配方发给朋友</p>'
      + '<div class="btn-row">'
      + '<button class="btn" data-act="shareText">📋 复制文本</button>'
      + '<button class="btn" data-act="shareImage">🖼 生成卡片图</button>'
      + '</div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">取消</button></div></div>';
  }

  var api = {
    esc: esc,
    imageHtml: imageHtml,
    cardHtml: cardHtml,
    cardListHtml: cardListHtml,
    emptyHtml: emptyHtml,
    detailHtml: detailHtml,
    filterBarHtml: filterBarHtml,
    searchHistoryHtml: searchHistoryHtml,
    listFooterHtml: listFooterHtml,
    rateStarsHtml: rateStarsHtml,
    pantryPanelHtml: pantryPanelHtml,
    pantrySuggestHtml: pantrySuggestHtml,
    makeableHtml: makeableHtml,
    cabinetListHtml: cabinetListHtml,
    ratedSectionHtml: ratedSectionHtml,
    cabinetHtml: cabinetHtml,
    historyEntryHtml: historyEntryHtml,
    allEntryHtml: allEntryHtml,
    historyPageHtml: historyPageHtml,
    shelfHtml: shelfHtml,
    shelfCardHtml: shelfCardHtml,
    sectionHeadHtml: sectionHeadHtml,
    blindHtml: blindHtml,
    addFormHtml: addFormHtml,
    settingsHtml: settingsHtml,
    tiersHtml: tiersHtml,
    aboutHtml: aboutHtml,
    confirmHtml: confirmHtml,
    importHtml: importHtml,
    shareHtml: shareHtml
  };
  globalThis.RJUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* 配方卡片生成长图（分享功能）。用 canvas 画一张竖版卡片，离线可用。
     Node 测试 / 无 canvas 环境下返回 rejected Promise，由调用方捕获。 */
  (function () {
    function render(drink) {
      return new Promise(function (resolve, reject) {
        var can = globalThis.document && globalThis.document.createElement('canvas');
        if (!can || !can.getContext) return reject(new Error('no canvas'));
        var ctx = can.getContext('2d');
        var W = 720, H = 1000;
        can.width = W; can.height = H;
        // 背景
        ctx.fillStyle = '#faf3e6';
        ctx.fillRect(0, 0, W, H);
        // 标题
        ctx.fillStyle = '#3a2e22';
        ctx.textAlign = 'center';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText(drink.name_display || drink.name_zh || '配方', W / 2, 80);
        ctx.fillStyle = '#8a7358';
        ctx.font = '26px sans-serif';
        ctx.fillText('配料', W / 2 - 250, 150);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#3a2e22';
        ctx.font = '28px sans-serif';
        var y = 200;
        (drink.ingredients_zh || ['未填写']).forEach(function (x) {
          wrapText(ctx, x, 70, y, W - 140);
          y += 46;
        });
        y += 30;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8a7358';
        ctx.font = '26px sans-serif';
        ctx.fillText('做法', 70, y);
        ctx.fillStyle = '#3a2e22';
        ctx.font = '28px sans-serif';
        y += 46;
        wrapText(ctx, drink.instructions_zh || '未填写', 70, y, W - 140);
        resolve(can.toDataURL('image/png'));
      });
    }
    function wrapText(ctx, text, x, y, maxWidth) {
      var chars = String(text).split('');
      var line = '';
      for (var i = 0; i < chars.length; i++) {
        var test = line + chars[i];
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, y);
          line = chars[i];
          y += 42;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, x, y);
      return y;
    }
    globalThis.RJUICard = { render: render };
  })();
})(typeof window !== 'undefined' ? window : globalThis);
