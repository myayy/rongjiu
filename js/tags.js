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

  /* 输入框里常见的外语名 / 口语名 → 库里的标准中文名 */
  var ING_ALIAS = {
    vodka: '伏特加', gin: '金酒', rum: '朗姆酒', 'white rum': '白朗姆酒', 'dark rum': '黑朗姆酒',
    whiskey: '威士忌', whisky: '威士忌', bourbon: '波本威士忌', scotch: '苏格兰威士忌',
    tequila: '龙舌兰', brandy: '白兰地', cognac: '干邑', sake: '清酒', soju: '烧酒',
    wine: '葡萄酒', 'red wine': '红葡萄酒', beer: '啤酒', champagne: '香槟',
    cola: '可乐', coke: '可乐', sprite: '雪碧', soda: '苏打水', 'soda water': '苏打水',
    'tonic water': '汤力水', lemonade: '柠檬水', 'ginger ale': '姜汁汽水',
    lemon: '柠檬', lime: '青柠', orange: '橙子', mint: '薄荷', sugar: '糖', syrup: '糖浆',
    honey: '蜂蜜', milk: '牛奶', cream: '淡奶油', coffee: '咖啡', tea: '茶',
    salt: '盐', grenadine: '红石榴糖浆', bitters: '苦精', vermouth: '味美思',
    campari: '金巴利', cointreau: '君度', kahlua: '甘露'
  };

  /* 单个词归一：别名优先，其次剥单位 */
  function aliasOf(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    return ING_ALIAS[s.toLowerCase()] || s;
  }

  /* 把一行输入拆成若干材料名：支持 / 、 , ; ； 与空格分隔
     （placeholder 里示范的就是「朗姆酒 / 可乐 / 青柠汁」这种写法，
      以前会被当做一个整体材料存进去，导致匹配不到任何配方） */
  function splitIngredients(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return [];
    var whole = ING_ALIAS[text.toLowerCase()];
    if (whole) return [whole];
    var out = [];
    text.split(/[\/、,;；\s]+/).forEach(function (part) {
      // 先剥单位（30毫升朗姆酒 → 朗姆酒），再查别名（vodka → 伏特加）
      var n = aliasOf(ingredientName(part.trim()));
      if (n && out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }

  /* 库里出现过的全部材料名（按出现次数降序），供「常见材料」候选用 */
  function ingredientPool(list) {
    var count = {};
    (list || []).forEach(function (d) {
      ingredientNames(d).forEach(function (n) {
        if (ING_STOP[n]) return;
        count[n] = (count[n] || 0) + 1;
      });
    });
    return Object.keys(count).sort(function (a, b) {
      return count[b] - count[a] || a.localeCompare(b, 'zh');
    }).map(function (n) {
      return { name: n, count: count[n] };
    });
  }

  function commonIngredients(list, topN) {
    return ingredientPool(list).slice(0, topN || 24);
  }

  function hasIngredient(drink, name) {
    var names = ingredientNames(drink);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf(name) !== -1) return true;
    }
    return false;
  }

  /* ---------- 我的材料 → 能做的酒 ---------- */
  /* 双向包含：家里有「朗姆酒」能命中配方的「白朗姆酒」，反向也命中 */
  function ingMatches(a, b) {
    if (!a || !b) return false;
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  }

  /* 这条配方还缺哪些材料：
     []    → 材料齐全
     [x]   → 还差 1 样（缺 x）
     [x,y] → 差太多，不进「能做的酒」
     null  → 没有可统计的材料（只有冰/水），不参与 */
  function pantryMissing(drink, pantry) {
    var names = ingredientNames(drink);
    var have = (pantry || []).filter(function (n) { return typeof n === 'string' && n; });
    var need = [];
    var countable = 0;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (ING_STOP[n]) continue;      // 冰块 / 冰 / 水 永远不算「缺」
      countable++;
      var ok = false;
      for (var j = 0; j < have.length; j++) {
        if (ingMatches(n, have[j])) { ok = true; break; }
      }
      if (!ok) need.push(n);
    }
    if (!countable) return null;
    return need;
  }

  /* 配方里有没有至少一样是「我手上有的」材料（冰/水不算） */
  function usedAny(drink, have) {
    var names = ingredientNames(drink);
    for (var i = 0; i < names.length; i++) {
      if (ING_STOP[names[i]]) continue;
      for (var j = 0; j < have.length; j++) {
        if (ingMatches(names[i], have[j])) return true;
      }
    }
    return false;
  }

  function pantryGroups(list, pantry) {
    var have = (pantry || []).filter(function (n) { return typeof n === 'string' && n; });
    var ready = [];
    var near = [];
    (list || []).forEach(function (d) {
      var miss = pantryMissing(d, have);
      if (miss === null) return;
      if (miss.length === 0) { ready.push({ drink: d, missing: null }); return; }
      if (miss.length !== 1) return;
      // 「还差 1 样」必须建立在「它要的材料里我已经有了一样」之上。
      // 否则只用一样材料的配方（纯威士忌一口饮之类）会把整组占满：
      // 用户随便录个冰红茶，看到的全是跟自己材料毫无关系的酒。
      if (!usedAny(d, have)) return;
      near.push({ drink: d, missing: miss[0] });
    });
    return { ready: ready, near: near };
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

  /* 类目中文映射：数据里 od- 源的 category 比较杂（既有标准分类，也有基酒/口味标签），
     命中映射表就显示中文，未命中保留原文，避免出现看不懂的英文。 */
  var CATEGORY_MAP = {
    'ordinary drink': '普通饮品', 'cocktail': '鸡尾酒', 'alcoholic': '含酒精饮品',
    'shot': '子弹杯', 'punch / party drink': '宾治 / 派对饮品', 'other / unknown': '其他',
    'coffee / tea': '咖啡 / 茶', 'coffee': '咖啡', 'tea': '茶', 'beer': '啤酒',
    'homemade liqueur': '自制利口酒', 'soft drink': '软饮', 'cocoa': '可可', 'shake': '奶昔',
    'non-alcoholic': '无酒精饮品', 'mocktail': '无酒精鸡尾酒', 'virgin': '无酒精特调',
    '饮料兑酒': '饮料兑酒', 'gin': '金酒', 'vodka': '伏特加', 'rum': '朗姆酒',
    'tequila': '龙舌兰', 'whiskey': '威士忌', 'whisky': '威士忌', 'bourbon': '波本威士忌',
    'brandy': '白兰地', 'cognac': '干邑', 'champagne': '香槟', 'wine': '葡萄酒',
    'red wine': '红葡萄酒', 'sake': '清酒', 'soju': '烧酒', 'somaek': '烧啤',
    'absinthe': '苦艾酒', 'cachaça': '卡莎萨', 'cachaca': '卡莎萨', 'mezcal': '梅斯卡尔',
    'schnapps': '利口酒', 'liqueur': '利口酒', 'vermouth': '味美思', 'campari': '金巴利',
    'aperol': '阿佩罗', 'kahlúa': '甘露', 'amaretto': '阿玛雷托', 'cointreau': '君度',
    'malibu': '马利宝', 'moscato': '莫斯卡托', 'port': '波特酒', 'sherry': '雪莉酒',
    'jameson': '尊美醇', 'jägermeister': '野格', 'fernet': '费内特',
    'becherovka': '贝赫洛夫卡', 'southern comfort': '南方安逸', 'white rum': '白朗姆酒',
    'black vodka': '黑伏特加', 'coconut rum': '椰子朗姆', 'aguardiente': '烧酒',
    'raki': '拉克酒', 'ricard': '里卡尔', 'rye': '黑麦威士忌', 'rumchata': '朗姆怡茶',
    'advocaat': '蛋黄酒', 'blue curaçao': '蓝橙皮酒', 'curaçao': '橙皮酒',
    'lime': '青柠', 'lemon': '柠檬', 'lemonade': '柠檬水', 'orange': '橙子',
    'apple': '苹果', 'strawberry': '草莓', 'banana': '香蕉', 'mango': '芒果',
    'watermelon': '西瓜', 'blueberry': '蓝莓', 'blackberry': '黑莓', 'raspberry': '覆盆子',
    'coconut': '椰子', 'coconut milk': '椰奶', 'pineapple': '菠萝', 'pomegranate': '石榴',
    'fig': '无花果', 'avocado': '牛油果', 'dragon fruit': '火龙果', 'chikoo': '人心果',
    'jamun': '蒲桃', 'berry': '浆果', 'melon': '哈密瓜', 'taro': '香芋',
    'orange juice': '橙汁', 'blood orange juice': '血橙汁', 'mango juice': '芒果汁',
    'lemon juice': '柠檬汁', 'cranberry juice': '蔓越莓汁', 'juice': '果汁',
    'peanut butter': '花生酱', 'peanuts': '花生', 'carrot': '胡萝卜', 'spinach': '菠菜',
    'tomato': '番茄', 'corn': '玉米', 'cereal': '谷物', 'yogurt': '酸奶', 'milk': '牛奶',
    'buttermilk': '酪乳', 'ice cream': '冰淇淋', 'milkshake': '奶昔', 'smoothie': '冰沙',
    'oreo': '奥利奥', 'chocolate': '巧克力', 'honey': '蜂蜜', 'vanilla': '香草',
    'caramel': '焦糖', 'cinnamon': '肉桂', 'cardamom': '小豆蔻', 'ginger': '姜',
    'ginger beer': '姜汁啤酒', 'mint': '薄荷', 'mint leaves': '薄荷叶', 'basil': '罗勒',
    'lavender': '薰衣草', 'hibiscus': '洛神花', 'elderflower': '接骨木花', 'matcha': '抹茶',
    'espresso': '浓缩咖啡', 'cold-coffee': '冷萃咖啡', 'coffee powder': '咖啡粉',
    'earl grey': '伯爵茶', 'black tea': '红茶', 'green tea': '绿茶', 'herbal tea': '草本茶',
    'iced tea': '冰茶', 'rooibos': '路易波士茶', 'mate': '马黛茶', 'thai tea': '泰式茶',
    'lassi': '拉西', 'horchata': '欧洽塔', 'sherbat': '雪葩', 'sharbat': '雪葩',
    'cremant': '克雷芒', 'sangria': '桑格利亚', 'cola': '可乐', 'coke': '可乐',
    'soda': '苏打水', 'sparkling water': '气泡水', 'orange soda': '橙味汽水',
    'cream soda': '奶油苏打', 'dr. pepper': '胡椒博士', 'fanta': '芬达',
    'schweppes': '怡泉', 'grenadine': '红石榴糖浆', 'simple syrup': '糖浆',
    'water': '水', 'ice': '冰', 'candy': '糖果', 'sparkling': '气泡',
    'tropical': '热带风味', 'cool': '清凉', 'cold': '冰镇', 'chilled': '冰镇',
    'hot': '热饮', 'warm': '温饮', 'fresh': '清爽', 'refreshing': '清爽',
    'fizzy': '气泡感', 'sweet': '甜', 'bitter': '苦', 'sour': '酸', 'spicy': '辛香',
    'strong': '浓烈', 'herbal': '草本', 'classic': '经典', 'classical': '经典',
    'traditional': '传统', 'easy': '简易', 'healthy': '健康', 'vegan': '纯素',
    'homemade': '自制', 'shaken': '摇和', 'low in alcohol': '低酒精',
    'summer': '夏日', 'fall': '秋日', 'christmas': '圣诞', 'holiday': '假日',
    'halloween': '万圣节', 'grinch': '绿毛怪', 'new york': '纽约', 'taiwan': '台湾',
    'mexico': '墨西哥', 'mexican': '墨西哥', 'brazilian': '巴西', 'indian': '印度',
    'sudanese': '苏丹', 'afghan': '阿富汗', 'vietnamese': '越南', 'tiki': '提基',
    'abc': 'ABC 果汁', 'margarita': '玛格丽特', 'negroni': '内格罗尼', 'bellini': '贝利尼',
    'martini': '马天尼', 'daiquiri': '大吉利', 'long island': '长岛',
    'bourbon mule': '波本骡子', 'brandy alexander': '白兰地亚历山大',
    'virgin mary': '无酒精血腥玛丽', 'gin sour': '金酒酸', 'spritz': '气泡饮',
    'highball': '高球', 'stout': '世涛', 'corona': '科罗娜', 'blue': '蓝', 'red': '红',
    'apple cider': '苹果西打', 'eggnog': '蛋奶酒', 'sugarcane': '甘蔗', 'soma': '苏摩酒'
  };

  /* 杯型中文映射 */
  var GLASS_MAP = {
    'cocktail glass': '鸡尾酒杯', 'highball glass': '高球杯', 'collins glass': '柯林杯',
    'old-fashioned glass': '古典杯', 'shot glass': '子弹杯', 'whiskey sour glass': '威士忌酸杯',
    'coffee mug': '马克杯', 'punch bowl': '宾治碗', 'champagne flute': '香槟杯',
    'hurricane glass': '飓风杯', 'pint glass': '品脱杯', 'wine glass': '葡萄酒杯',
    'martini glass': '马天尼杯', 'irish coffee cup': '爱尔兰咖啡杯', 'pitcher': '水壶',
    'beer mug': '啤酒马克杯', 'beer pilsner': '皮尔森啤酒杯', 'margarita glass': '玛格丽特杯',
    'white wine glass': '白葡萄酒杯', 'margarita/coupette glass': '玛格丽特 / 碟形杯',
    'balloon glass': '球形杯', 'brandy snifter': '白兰地杯', 'nick and nora glass': '尼克与诺拉杯',
    'cordial glass': '利口酒杯', 'beer glass': '啤酒杯', 'mason jar': '梅森罐',
    'whiskey glass': '威士忌杯', 'pousse cafe glass': '普施咖啡杯', 'jar': '罐',
    'copper mug': '铜杯', 'parfait glass': '芭菲杯', 'coupe glass': '碟形香槟杯',
    'whisky glass': '威士忌杯', 'beer pilsner glass': '皮尔森啤酒杯'
  };

  function categoryLabel(raw) {
    var k = String(raw == null ? '' : raw).trim();
    if (!k) return '';
    return CATEGORY_MAP[k.toLowerCase()] || k;
  }

  function glassLabel(raw) {
    var k = String(raw == null ? '' : raw).trim();
    if (!k) return '';
    return GLASS_MAP[k.toLowerCase()] || k;
  }

  /* 酒精标签统一文案（含「少量含酒精」的 Optional alcohol） */
  function alcoholLabel(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    if (!s) return '';
    if (s.indexOf('non') === 0 || s.indexOf('alcohol-free') === 0) return '无酒精';
    if (s.indexOf('optional') === 0) return '可选含酒精';
    if (s.indexOf('alcoholic') === 0) return '含酒精';
    return String(raw);
  }

  function isNonAlcoholic(drink) {
    return /^non/i.test(String((drink && drink.alcoholic) || ''));
  }

  /* ----- 推荐页分区（混合维度，每款酒只进一个区） -----
     数组顺序即优先级：先匹配到的分区占位，保证不重复。
     特色区在前（兑酒 / Shot / 无酒精 / 咖啡茶），再按基酒分，最后用经典鸡尾酒兜底。 */
  function ingHasZh(drink, words) {
    var items = drink.ingredients_zh || [];
    for (var i = 0; i < items.length; i++) {
      var s = String(items[i]);
      for (var j = 0; j < words.length; j++) if (s.indexOf(words[j]) !== -1) return true;
    }
    return false;
  }

  function ingHasEn(drink, re) {
    var items = drink.ingredients_en || [];
    for (var i = 0; i < items.length; i++) if (re.test(String(items[i]))) return true;
    return false;
  }

  function bySpirit(zhWords, enRe) {
    return function (d) {
      return ingHasZh(d, zhWords) || (enRe ? ingHasEn(d, enRe) : false);
    };
  }

  var SECTIONS = [
    { id: 'mixer', label: '中国饮料兑酒', hint: '汽水、茶饮、椰汁都能兑',
      test: function (d) { return /^cn-/.test(String(d.id)); } },
    { id: 'shot', label: '一口闷 Shot', hint: '小杯一口，利落干脆',
      test: function (d) { return categoryLabel(d.category) === '子弹杯'; } },
    { id: 'mocktail', label: '无酒精特调', hint: '开车也能喝',
      test: function (d) { return isNonAlcoholic(d); } },
    { id: 'coffee', label: '咖啡与茶', hint: '提神系调饮',
      test: function (d) { return /咖啡|茶|可可/.test(categoryLabel(d.category)); } },
    { id: 'vodka', label: '伏特加调酒', hint: '百搭基酒',
      test: bySpirit(['伏特加'], /\bvodka\b/i) },
    { id: 'gin', label: '金酒调酒', hint: '草本清香',
      test: bySpirit(['金酒', '杜松子酒'], /\bgin\b/i) },
    { id: 'rum', label: '朗姆调酒', hint: '甘蔗甜香',
      test: bySpirit(['朗姆'], /\brum\b/i) },
    { id: 'whisky', label: '威士忌调酒', hint: '烟熏木质',
      test: bySpirit(['威士忌'], /\bwhisk|\bbourbon\b|\bscotch\b|\brye\b/i) },
    { id: 'tequila', label: '龙舌兰调酒', hint: '墨西哥风情',
      test: bySpirit(['龙舌兰'], /\btequila\b|\bmezcal\b/i) },
    { id: 'classic', label: '经典鸡尾酒', hint: '剩下的好酒都在这儿',
      test: function () { return true; } }
  ];

  /* 归类：返回 [{ id, label, hint, drinks }]，空分区不返回 */
  function groupSections(drinks) {
    var buckets = {};
    SECTIONS.forEach(function (s) { buckets[s.id] = []; });
    (drinks || []).forEach(function (d) {
      for (var i = 0; i < SECTIONS.length; i++) {
        if (SECTIONS[i].test(d)) { buckets[SECTIONS[i].id].push(d); return; }
      }
    });
    return SECTIONS.map(function (s) {
      return { id: s.id, label: s.label, hint: s.hint, drinks: buckets[s.id] };
    }).filter(function (s) { return s.drinks.length > 0; });
  }

  /* 单条配方属于哪个分区 */
  function sectionOf(drink) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].test(drink)) return SECTIONS[i].id;
    }
    return 'classic';
  }

  function sectionById(id) {
    if (id === 'all') return { id: 'all', label: '全部配方', hint: '慢慢挑', all: true };
    if (id === 'mine') return { id: 'mine', label: '我的自制', hint: '你自己加进去的配方', mine: true };
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    return null;
  }

  /* ----- 按基酒的独立视图（不受互斥分区限制） ----- */
  var SPIRITS = [
    { id: 'vodka', label: '伏特加', zh: ['伏特加'], en: /\bvodka\b/i },
    { id: 'gin', label: '金酒', zh: ['金酒', '杜松子酒'], en: /\bgin\b/i },
    { id: 'rum', label: '朗姆酒', zh: ['朗姆'], en: /\brum\b/i },
    { id: 'whisky', label: '威士忌', zh: ['威士忌', '波本'], en: /\bwhisk|\bbourbon\b|\bscotch\b|\brye\b/i },
    { id: 'tequila', label: '龙舌兰', zh: ['龙舌兰'], en: /\btequila\b|\bmezcal\b/i },
    { id: 'brandy', label: '白兰地', zh: ['白兰地', '干邑'], en: /\bbrandy\b|\bcognac\b/i },
    { id: 'soju', label: '烧酒', zh: ['烧酒', '清酒'], en: /\bsoju\b|\bsake\b|\baguardiente\b/i },
    { id: 'liqueur', label: '利口酒', zh: ['利口酒', '君度', '金巴利', '阿佩罗', '甘露', '野格'], en: /\bliqueur\b|\bcampari\b|\baperol\b|\bkahlua\b|\bjagemmeister\b|\bamaretto\b/i }
  ];

  /* 某条配方用到哪些基酒（按含料判断） */
  function spiritIdsOf(drink) {
    var out = [];
    for (var i = 0; i < SPIRITS.length; i++) {
      var s = SPIRITS[i];
      if (ingHasZh(drink, s.zh) || (s.en ? ingHasEn(drink, s.en) : false)) out.push(s.id);
    }
    return out;
  }

  /* 全库按基酒分组：只在用到该基酒的配方里分类，不互斥（一款酒可出现在多个基酒下） */
  function groupBySpirit(list) {
    return SPIRITS.map(function (s) {
      var drinks = (list || []).filter(function (d) { return spiritIdsOf(d).indexOf(s.id) !== -1; });
      return { id: s.id, label: s.label, drinks: drinks };
    });
  }

  function spiritById(id) {
    for (var i = 0; i < SPIRITS.length; i++) if (SPIRITS[i].id === id) return SPIRITS[i];
    return null;
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
    splitIngredients: splitIngredients,
    aliasOf: aliasOf,
    ingredientPool: ingredientPool,
    commonIngredients: commonIngredients,
    hasIngredient: hasIngredient,
    ingMatches: ingMatches,
    pantryMissing: pantryMissing,
    pantryGroups: pantryGroups,
    estimatePrice: estimatePrice,
    categoryLabel: categoryLabel,
    glassLabel: glassLabel,
    alcoholLabel: alcoholLabel,
    isNonAlcoholic: isNonAlcoholic,
    SECTIONS: SECTIONS,
    groupSections: groupSections,
    sectionOf: sectionOf,
    sectionById: sectionById,
    SPIRITS: SPIRITS,
    spiritIdsOf: spiritIdsOf,
    groupBySpirit: groupBySpirit,
    spiritById: spiritById,
    defaultTiers: defaultTiers,
    normalizeTiers: normalizeTiers,
    priceInTier: priceInTier,
    tierOf: tierOf
  };

  globalThis.RJTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
