/* 口感标签 + 价格档位（档位可自定义） */
(function (global) {
  'use strict';

  /* ---------- 口感规则：正则命中即打标签 ---------- */
  var TASTE_RULES = [
    { tag: '浓烈', re: /伏特加|金酒|杜松子酒|朗姆|威士忌|波本|龙舌兰|白兰地|干邑|苦艾|烈酒|151|vodka|gin|rum|whisk(e)?y|bourbon|tequila|brandy|cognac/i },
    { tag: '清爽', re: /苏打|气泡|汤力|姜汁|柠檬|青柠|薄荷|冰|雪碧|七喜|soda|tonic|ginger|lime|lemon|mint|ice|sprite/i },
    { tag: '酸甜', re: /柠檬汁|青柠汁|酸|糖浆|红石榴|蜂蜜|糖|果汁|糖水|sour|syrup|honey|sugar|grenadine/i },
    { tag: '果香', re: /橙|菠萝|芒果|草莓|西瓜|葡萄|苹果|桃|椰|浆果|柠檬|青柠|西柚|果汁|杏|樱桃|香蕉|pineapple|mango|orange|apple|coconut|juice|berry/i },
    { tag: '奶香', re: /奶油|牛奶|椰奶|炼乳|酸奶|奶|蛋清|cream|milk|yogurt|yoghurt|egg white/i },
    { tag: '苦味', re: /苦精|金巴利|苦艾|阿佩罗|咖啡|巧克力|可可|茶|campari|aperol|bitter|espresso|coffee|cocoa|chocolate|tea/i },
    { tag: '气泡', re: /苏打|气泡|香槟|可乐|起泡|香槟|champagne|sparkling|cola|soda|prosecco|cava/i },
    { tag: '草本', re: /薄荷|罗勒|迷迭香|百里香|茴香|八角|香草|芫荽|罗勒|mint|basil|rosemary|thyme|anise|vanilla|herb/i }
  ];

  var ALL_TASTE_TAGS = ['浓烈', '清爽', '酸甜', '果香', '奶香', '苦味', '气泡', '草本'];

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
      out.push(String(drink.alcoholic || '').toLowerCase().indexOf('non') === 0 ? '清爽' : '浓烈');
    }
    return out;
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
    deriveTastes: deriveTastes,
    estimatePrice: estimatePrice,
    defaultTiers: defaultTiers,
    normalizeTiers: normalizeTiers,
    priceInTier: priceInTier,
    tierOf: tierOf
  };

  globalThis.RJTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
