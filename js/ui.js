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

  function priceOf(drink, tagsApi) {
    return tagsApi.estimatePrice(drink);
  }

  function cardHtml(drink, opts, tagsApi) {
    opts = opts || {};
    var inCab = !!opts.inCabinet;
    var tastes = tagsApi.deriveTastes(drink);
    var price = priceOf(drink, tagsApi);
    var chips = '<span class="chip">' + esc(drink.category || '未分类') + '</span>';
    chips += '<span class="chip ' + (String(drink.alcoholic).indexOf('Non') === 0 ? 'green' : 'accent') + '">'
      + (String(drink.alcoholic).indexOf('Non') === 0 ? '无酒精' : '含酒精') + '</span>';
    chips += '<span class="chip">' + price + '元</span>';
    chips += '<span class="chip">' + esc(tastes[0]) + (tastes.length > 1 ? '等' : '') + '</span>';
    if (drink.source === 'custom') chips += '<span class="chip accent">自制</span>';

    var heart = opts.compact ? '' :
      '<div class="card-actions"><button class="heart' + (inCab ? ' on' : '') + '" data-act="toggle" data-id="'
      + esc(drink.id) + '">' + (inCab ? '✓ 已在酒柜' : '＋ 加入酒柜') + '</button></div>';

    return '<div class="card" data-act="open" data-id="' + esc(drink.id) + '">'
      + imageHtml(drink, 'card-img')
      + '<div class="card-body"><div class="card-title">' + esc(drink.name_display) + '</div>'
      + '<div class="card-meta">' + chips + '</div>' + heart
      + '</div></div>';
  }

  function cardListHtml(drinks, opts, tagsApi) {
    if (!drinks.length) return emptyHtml(opts.empty || {});
    return drinks.map(function (d) { return cardHtml(d, opts, tagsApi); }).join('');
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

    var kv = '<span class="chip">' + esc(drink.category || '未分类') + '</span>'
      + '<span class="chip ' + (String(drink.alcoholic).indexOf('Non') === 0 ? 'green' : 'accent') + '">'
      + esc(drink.alcoholic || '未知酒精度') + '</span>'
      + (drink.glass ? '<span class="chip">' + esc(drink.glass) + '</span>' : '')
      + '<span class="chip">约 ' + price + '元' + (tier ? ' · ' + esc(tier.label) : '') + '</span>'
      + tastes.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');

    var ings = (drink.ingredients_zh || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');

    var cabBtn = opts.inCabinet
      ? '<button class="btn subtle" data-act="toggle" data-id="' + esc(drink.id) + '">✓ 已在酒柜 · 点击移除</button>'
      : '<button class="btn" data-act="toggle" data-id="' + esc(drink.id) + '">＋ 加入酒柜</button>';

    return '<button class="back-btn" data-act="back">← 返回</button>'
      + '<div class="detail-hero">' + imageHtml(drink, 'detail-img') + '</div>'
      + '<div class="detail-name">' + esc(drink.name_display) + '</div>'
      + '<div class="kv">' + kv + '</div>'
      + '<div class="btn-row">' + cabBtn
      + (drink.source === 'custom'
        ? '<button class="btn danger" data-act="delCustom" data-id="' + esc(drink.id) + '">删除</button>'
        : '')
      + '</div>'
      + '<div class="detail-section"><h3>配料</h3><ul>' + (ings || '<li>未填写</li>') + '</ul></div>'
      + '<div class="detail-section"><h3>做法</h3><p>' + esc(drink.instructions_zh || '未填写') + '</p></div>'
      + (drink.instructions_en ? '<div class="detail-section"><h3>做法（英文原文）</h3><p>' + esc(drink.instructions_en) + '</p></div>' : '')
      + (drink.source_url ? '<div class="detail-section"><h3>来源</h3><p><a href="' + esc(drink.source_url) + '" target="_blank" rel="noopener">' + esc(drink.source_url) + '</a></p></div>' : '');
  }

  function filterBarHtml(state, categories) {
    var chips = categories.map(function (c) {
      return '<button class="fchip' + (state.category === c ? ' on' : '') + '" data-act="cat" data-val="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    var alc = [['', '全部'], ['yes', '含酒精'], ['no', '无酒精']].map(function (p) {
      return '<button class="fchip' + ((state.alcoholic || '') === p[0] ? ' on' : '') + '" data-act="alc" data-val="' + esc(p[0]) + '">' + p[1] + '</button>';
    }).join('');
    return '<div class="filterbar">'
      + '<input class="search" type="text" id="searchInput" placeholder="搜索中文名 / 英文名 / 配料…" value="' + esc(state.q || '') + '">'
      + '<div class="chips">' + alc + '</div>'
      + (chips ? '<div class="chips scroll">' + chips + '</div>' : '')
      + '</div>';
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

    return '<div class="box-panel"><h3>价格档位（可自定义）</h3><p class="hint">点选一个或多个档位</p>'
      + '<div class="chips">' + tierChips + '</div></div>'
      + '<div class="box-panel"><h3>想要的口感</h3><p class="hint">命中任一所选标签即可入池</p>'
      + '<div class="chips">' + tasteChips + '</div>'
      + '<div class="chips" style="margin-top:10px">' + alc + '</div></div>'
      + '<div class="box-count">符合条件：' + pool.length + ' 款</div>'
      + result
      + '<div class="btn-row"><button class="btn" data-act="blindDraw" ' + (pool.length ? '' : 'disabled') + '>🎯 抽一瓶</button></div>';
  }

  /* ---- 新增配方表单 ---- */
  function addFormHtml() {
    return '<div class="sheet"><h2>新增配方</h2><p class="sub">保存在本机浏览器，刷新不丢</p>'
      + '<div class="form">'
      + '<label>名称 *</label><input type="text" id="fName" placeholder="例如：融酒特调">'
      + '<label>分类</label><input type="text" id="fCategory" placeholder="例如：Cocktail / 自制">'
      + '<label>是否含酒精</label><select id="fAlc"><option value="Alcoholic">含酒精</option><option value="Non alcoholic">无酒精</option></select>'
      + '<label>杯型</label><input type="text" id="fGlass" placeholder="例如：Highball glass">'
      + '<label>配料 *（每行一条）</label><textarea id="fIng" placeholder="45毫升伏特加&#10;15毫升柠檬汁"></textarea>'
      + '<label>做法</label><textarea id="fStep" placeholder="摇匀，滤入杯中。"></textarea>'
      + '<div class="err" id="fErr"></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">取消</button>'
      + '<button class="btn" data-act="saveRecipe">保存</button></div>'
      + '</div></div>';
  }

  /* ---- 详情/盲盒结果复用按钮行 ---- */
  function settingsHtml(opts) {
    opts = opts || {};
    return '<div class="sheet"><h2>设置</h2><p class="sub">数据仅保存在本机浏览器</p>'
      + '<div class="menu-item" data-act="newRecipe"><span>＋ 新增配方</span><span class="val">自制入库</span></div>'
      + '<div class="menu-item" data-act="export"><span>⬇ 导出备份</span><span class="val">JSON 文件</span></div>'
      + '<div class="menu-item" data-act="import"><span>⬆ 导入备份</span><span class="val">合并 / 覆盖</span></div>'
      + '<div class="menu-item" data-act="tiers"><span>¥ 价格档位</span><span class="val">' + (opts.tierCount || 3) + ' 档 · 可自定义</span></div>'
      + '<div class="menu-item" data-act="about"><span>ⓘ 关于与数据来源</span><span class="val"></span></div>'
      + '<div class="menu-item danger" data-act="clearAll"><span>🗑 清空全部数据</span><span class="val">酒柜 + 自制</span></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="closeOverlay">关闭</button></div>'
      + '</div>';
  }

  function tiersHtml(tiers, err) {
    var rows = tiers.map(function (t, i) {
      return '<div class="tier-row">'
        + '<input type="text" class="tier-label" data-tier-label="' + i + '" value="' + esc(t.label) + '" placeholder="档位名">'
        + '<input type="number" data-tier-min="' + i + '" value="' + esc(t.min) + '" placeholder="最低">'
        + '<input type="number" data-tier-max="' + i + '" value="' + (t.max === Infinity || t.max === null ? '' : esc(t.max)) + '" placeholder="最高(留空=不限)">'
        + '<button class="del" data-act="delTier" data-idx="' + i + '">✕</button>'
        + '</div>';
    }).join('');
    return '<div class="sheet"><h2>价格档位</h2><p class="sub">自定义盲盒的价格分档，最高档留空表示不限</p>'
      + '<div id="tierList">' + rows + '</div>'
      + '<div class="err" id="tierErr">' + esc(err || '') + '</div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="addTier">＋ 加一档</button></div>'
      + '<div class="btn-row"><button class="btn subtle" data-act="resetTiers">恢复默认</button>'
      + '<button class="btn" data-act="saveTiers">保存</button></div>'
      + '</div>';
  }

  function aboutHtml() {
    return '<div class="sheet about"><h2>关于 · 融酒</h2>'
      + '<p>纯本地运行的调酒助手：不联网、不登录、数据只存在本机浏览器里。刷新、关闭、重启都不丢；建议定期「导出备份」。</p>'
      + '<p><b>数据来源与署名</b></p>'
      + '<p>· TheCocktailDB（https://www.thecocktaildb.com/）— 免费开放 API，非商业 / 学习用途，需保留署名。</p>'
      + '<p>· Open Drinks（https://github.com/alfg/opendrinks）— MIT 许可。</p>'
      + '<p>仅限个人本地自用，请勿公开上架或商用。价格为规则估算，仅供盲盒分档参考；用量单位保留原文，未做统一换算。</p>'
      + '<div class="btn-row"><button class="btn" data-act="closeOverlay">知道了</button></div></div>';
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

  var api = {
    esc: esc,
    imageHtml: imageHtml,
    cardHtml: cardHtml,
    cardListHtml: cardListHtml,
    emptyHtml: emptyHtml,
    detailHtml: detailHtml,
    filterBarHtml: filterBarHtml,
    blindHtml: blindHtml,
    addFormHtml: addFormHtml,
    settingsHtml: settingsHtml,
    tiersHtml: tiersHtml,
    aboutHtml: aboutHtml,
    importHtml: importHtml
  };
  globalThis.RJUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
