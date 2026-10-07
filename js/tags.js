/* 口感标签 + 价格档位（档位可自定义） */
(function (global) {
  'use strict';

  /* ---------- 口感规则：正则命中即打标签（依据 PRO.md 5.4 的 9 类） ---------- */
  var TASTE_RULES = [
    { tag: '甜', re: /糖|蜂蜜|红石榴|甜味美思|君度|白橙皮酒|杏仁酒|阿玛雷托|咖啡利口酒|百利甜|可可甜酒|蓝橙|桃味|马拉斯奇诺|桑布卡|枫糖|龙舌兰糖浆|sugar|syrup|grenadine|honey|sweet vermouth|triple sec|amaretto|kahlua|baileys|creme de cacao|blue curacao|peach schnapps|maraschino|sambuca|cointreau|maple|agave/i },
    { tag: '酸', re: /酸味|酸甜|酸橙|青柠|柠檬|西柚|葡萄柚|柚子|lime|lemon|grapefruit|sour|yuzu/i },
    { tag: '苦', re: /苦精|苦味|金巴利|阿佩罗|费内特|阿玛罗|西娜|苏兹|比特酒|安高天娜|bitters|angostura|campari|aperol|fernet|amaro|cynar|suze/i },
    { tag: '清爽', re: /苏打|气泡|汤力|通宁|姜汁|姜啤|薄荷|黄瓜|罗勒|柠檬水|雪碧|七喜|可乐|soda water|tonic|club soda|sparkling|ginger ale|ginger beer|mint|cucumber|basil|lemonade/i },
    { tag: '浓郁', re: /奶油|牛奶|椰奶|炼乳|酸奶|蛋|冰淇淋|巧克力|甘露|cream|milk|egg|baileys|kahlua|chocolate|ice cream|yogurt|coconut milk/i },
    { tag: '果味', re: /橙汁|菠萝汁|蔓越莓汁|苹果汁|草莓|芒果|桃|香蕉|樱桃|百香果|石榴|果汁|葡萄|西瓜|蓝莓|覆盆子|orange juice|pineapple juice|cranberry juice|apple juice|strawberry|mango|peach|banana|cherry|passion fruit|pomegranate|berry|grape|watermelon|raspberry|blueberry/i },
    { tag: '辛香', re: /姜|肉桂|豆蔻|丁香|胡椒|辣椒|茴香|八角|ginger|cinnamon|nutmeg|clove|pepper|chili|cardamom|anise|fennel/i },
    { tag: '咖啡', re: /咖啡|冷萃|提亚玛丽亚|coffee|espresso|cold brew|kahlua|tia maria/i },
    { tag: '茶', re: /茶叶|茶汤|红茶|绿茶|白茶|伯爵茶|抹茶|乌龙茶|奶茶|柠檬茶|茶包|\btea\b|chai|matcha|earl grey|green tea|black tea/i }
  ];

  var ALL_TASTE_TAGS = ['甜', '酸', '苦', '清爽', '浓郁', '果味', '辛香', '咖啡', '茶'];

  function tasteText(drink) {
    var parts = [];
    if (Array.isArray(drink.ingredients_zh)) parts = parts.concat(drink.ingredients_zh);
    if (Array.isArray(drink.ingredients_en)) parts = parts.concat(drink.ingredients_en);
    return parts.join(' ');
  }

  function deriveTastes(drink) {
    var text = tasteText(drink);
    var out = [];
    for (var i = 0; i < TASTE_RULES.length; i++) {
      if (TASTE_RULES[i].re.test(text)) out.push(TASTE_RULES[i].tag);
    }
    if (out.length === 0) {
      out.push(String(drink.alcoholic || '').toLowerCase().indexOf('non') === 0 ? '清爽' : '浓郁');
    }
    return out;
  }

  /* ---------- 酒精强度：数据无 ABV，按配料自动分档 ---------- */
  var SPIRIT_RE = /伏特加|金酒|杜松子酒|朗姆|威士忌|波本|龙舌兰|白兰地|干邑|苦艾酒|清酒|烧酒|烈酒|生命之水|151|\bvodka\b|\bgin\b|\brum\b|whisk(e)?y|bourbon|tequila|brandy|cognac|absinthe|\bsake\b|everclear/i;

  var STRENGTHS = [
    { id: 'none', label: '无酒精' },
    { id: 'low', label: '低度' },
    { id: 'high', label: '高度' }
  ];

  function strength(drink) {
    if (/^non/i.test(String(drink.alcoholic || ''))) return 'none';
    return SPIRIT_RE.test(tasteText(drink)) ? 'high' : 'low';
  }

  /* ---------- 常见材料：从配料名自动汇总 ---------- */
  var ING_STOP = { '冰块': 1, '冰': 1, '水': 1 };

  function ingredientName(raw) {
    return String(raw === undefined || raw === null ? '' : raw)
      .replace(/[（(].*$/, '')
      .replace(/^[\d.]+\s*(毫升|毫昇|克|盎司|大勺|小勺|汤匙|茶匙|勺|杯|份|滴|片|个|块|oz|ml|cl|dash|tsp|tbsp|cup|slice|splash|part|shot|jigger)\s*/i, '')
      .trim();
  }

  function ingredientNames(drink) {
    var arr = Array.isArray(drink.ingredients_zh) ? drink.ingredients_zh : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var n = ingredientName(arr[i]);
      if (n && out.indexOf(n) === -1) out.push(n);
    }
    return out;
  }

  function commonIngredients(list, topN) {
    var count = {};
    (list || []).forEach(function (d) {
      ingredientNames(d).forEach(function (n) {
        if (ING_STOP[n]) return;
        count[n] = (count[n] || 0) + 1;
      });
    });
    return Object.keys(count).sort(function (a, b) {
      return count[b] - count[a] || a.localeCompare(b, 'zh');
    }).slice(0, topN || 24).map(function (n) {
      return { name: n, count: count[n] };
    });
  }

  function hasIngredient(drink, name) {
    var names = ingredientNames(drink);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf(name) !== -1) return true;
    }
    return false;
  }

  /* ---------- 价格估算（元/杯）：同组取最高，跨组累加 ---------- */
  var PRICE_RULES = [
    { group: 'vodka', cost: 15, re: /伏特加|\bvodka\b/i },
    { group: 'gin', cost: 18, re: /金酒|杜松子酒|\bgin\b/i },
    { group: 'rum', cost: 15, re: /朗姆|\brum\b/i },
    { group: 'whiskey', cost: 25, re: /威士忌|波本|whisk(?:e)?y|bourbon/i },
    { group: 'tequila', cost: 25, re: /龙舌兰|\btequila\b/i },
    { group: 'brandy', cost: 40, re: /白兰地|干邑|brandy|cognac/i },
    { group: 'champagne', cost: 60, re: /香槟|champagne|prosecco/i },
    { group: 'fortified', cost: 20, re: /味美思|苦艾|苦艾酒|vermouth|\bsake\b|清酒/i },
    { group: 'liqueur', cost: 15, re: /利口酒|君度|橙皮甜酒|咖啡利口|金万利|阿佩罗|金巴利|甜酒|三重酒|triple sec|liqueur|campari|aperol|cointreau|amaro/i },
    { group: 'beer', cost: 8, re: /啤酒|\bbeer\b|stout|黑啤/i },
    { group: 'wine', cost: 20, re: /葡萄酒|红酒|干红|干白|sangria|\bwine\b/i },
    { group: 'otherSpirit', cost: 15, re: /151|生命之水|苦精|茴香酒|whisky|pernod|absinthe/i },
    { group: 'juice', cost: 3, re: /汁|juice/i },
    { group: 'soda', cost: 2, re: /苏打|气泡水|可乐|雪碧|七喜|汤力|soda|tonic|cola|sprite|7-up|ginger ale/i },
    { group: 'cream', cost: 4, re: /奶油|牛奶|椰奶|炼乳|酸奶|奶|cream|milk|yogurt|coconut milk/i },
    { group: 'syrup', cost: 2, re: /糖浆|红石榴|蜂蜜|糖|syrup|honey|grenadine|sugar/i },
    { group: 'fruit', cost: 3, re: /橙|菠萝|芒果|草莓|西瓜|葡萄|苹果|桃|椰|浆果|柠檬|青柠|樱桃|香蕉|菠萝|pineapple|mango|orange|apple|coconut|strawberry|berry|banana|cherry|lime|lemon/i },
    { group: 'teaCoffee', cost: 3, re: /茶|咖啡|可可|巧克力|tea|coffee|espresso|cocoa|chocolate/i },
    { group: 'garnish', cost: 1, re: /装饰|薄荷叶|罗勒|橄榄|garnish|mint leaf|olive/i },
    { group: 'base', cost: 5, re: /冰|水|蛋|苏打水|\bice\b|\bwater\b|egg/i }
  ];

  function priceText(drink) {
    return tasteText(drink);
  }

  function estimatePrice(drink) {
    var text = priceText(drink);
    var best = {};
    for (var i = 0; i < PRICE_RULES.length; i++) {
      var r = PRICE_RULES[i];
      if (r.re.test(text) && (!best[r.group] || r.cost > best[r.group])) {
        best[r.group] = r.cost;
      }
    }
    var sum = 0;
    var groups = Object.keys(best);
    for (var j = 0; j < groups.length; j++) sum += best[groups[j]];
    if (sum < 5) sum = 5;
    return Math.round(sum);
  }

  /* ---------- 价格档位：默认档位可被用户自定义档位覆盖 ---------- */
  function defaultTiers() {
    return [
      { id: 'low', label: '30元内', min: 0, max: 30 },
      { id: 'mid', label: '30–80元', min: 30, max: 80 },
      { id: 'high', label: '80元以上', min: 80, max: Infinity }
    ];
  }

  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return defaultTiers();
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (!t || typeof t.label !== 'string' || !t.label.trim()) continue;
      var min = Number(t.min);
      // max 支持 null/''/undefined（= 不限）；Infinity 无法 JSON 序列化，读取时还原
      var max = (t.max === null || t.max === undefined || t.max === '') ? Infinity : Number(t.max);
      if (!isFinite(min)) min = 0;
      if (Number.isNaN(max)) max = Infinity;
      out.push({
        id: typeof t.id === 'string' && t.id ? t.id : 't' + i,
        label: t.label.trim(),
        min: min,
        max: max
      });
    }
    return out.length ? out : defaultTiers();
  }

  function priceInTier(price, tier) {
    return price >= tier.min && price < tier.max;
  }

  function tierOf(price, tiers) {
    var list = normalizeTiers(tiers);
    for (var i = 0; i < list.length; i++) {
      if (priceInTier(price, list[i])) return list[i];
    }
    return null;
  }

  var api = {
    ALL_TASTE_TAGS: ALL_TASTE_TAGS,
    TASTE_RULES: TASTE_RULES,
    PRICE_RULES: PRICE_RULES,
    STRENGTHS: STRENGTHS,
    deriveTastes: deriveTastes,
    strength: strength,
    ingredientName: ingredientName,
    ingredientNames: ingredientNames,
    commonIngredients: commonIngredients,
    hasIngredient: hasIngredient,
    estimatePrice: estimatePrice,
    defaultTiers: defaultTiers,
    normalizeTiers: normalizeTiers,
    priceInTier: priceInTier,
    tierOf: tierOf
  };

  globalThis.RJTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
