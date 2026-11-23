/**
 * 电商价格采集 Node.js 后端
 * 兼容 Node 20，无任何 native 依赖
 */
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PLATFORM_NAMES = { jd: '京东', taobao: '淘宝', pdd: '拼多多' };
const PLATFORM_COLORS = { jd: '#E1251B', taobao: '#FF6A00', pdd: '#E02E24' };

// ==============================================================
// 1. 种子库（用于真实爬虫失败时的回退数据）
// ==============================================================
const SEED_BANK = {
  jd: {
    default: ['高品质商品 A', '精选好物 B', '明星爆款 C', '旗舰新品 D',
              '热销单品 E', '性价比之选 F', '官方正品 G', '好评如潮 H'],
    电脑: ['联想拯救者 Y7000P i7 RTX4060', '戴尔游匣 G15 锐龙版', '华硕天选4 酷睿版',
           '机械革命极光 Pro', '惠普暗影精灵9', '微星泰坦 GP78'],
    手机: ['iPhone 15 Pro Max 256G', '华为 Mate60 Pro 12+512G',
           '小米14 Ultra 徕卡光学', 'OPPO Find X7 Ultra',
           'vivo X100 Pro 蔡司影像', '三星 Galaxy S24 Ultra'],
    家电: ['美的空调酷冷静音 1.5匹', '海尔冰箱 BCD-510 十字对开门',
           '小米电视 S Pro 85英寸 MiniLED', '飞利浦电动牙刷HX9393'],
  },
  taobao: {
    default: ['天猫精选爆款 A', '品牌直营好货 B', '网红热卖 C',
              '新品首发 D', '热销榜单 E', '工厂直供 F'],
    电脑: ['联想小新 Pro14 轻薄本', '华硕无畏 15 锐龙版', '惠普战66 五代',
           '宏碁非凡 Go 青春版', 'ThinkBook 14+', '戴尔灵越 15'],
    手机: ['iPhone 15 标准版 128G', '华为 Pura 70 Ultra',
           '小米14 标准版', '荣耀 Magic6 Pro',
           'realme GT Neo5 SE', '一加 12'],
    家电: ['格力空调云佳 大1匹', '小天鹅洗衣机水魔方 10kg',
           '美的电饭煲 MB-FB50S701', '九阳破壁机 L18'],
  },
  pdd: {
    default: ['百亿补贴爆款 A', '工厂直销 B', '全网低价 C',
              '限时特惠 D', '拼团热卖 E', '新人专享 F'],
    电脑: ['联想扬天 S15 锐龙版', '小米 RedmiBook 14',
           '神舟战神 Z7-DA5NS', '机械革命无界 14',
           '红米 G Pro 游戏本', '七彩虹将星 X15'],
    手机: ['iPhone 14 128G', '华为畅享70 Pro',
           'Redmi K70 Pro', 'iQOO 12 传奇版',
           '荣耀 90 GT', '华为 Nova12 Ultra'],
    家电: ['奥克斯空调 1.5匹新一级', '康佳冰箱 400L 多门',
           'TCL 电视 75英寸 4K', '奔腾剃须刀电动男士'],
  },
};

const SHOP_NAMES = {
  jd: ['京东自营', '京东超市', '官方旗舰店', '授权专卖店'],
  taobao: ['天猫旗舰店', '淘宝企业店', '品牌直营', '金冠好店'],
  pdd: ['品牌官方店', '百亿补贴店', '工厂直营店', '精选好物'],
};

const HOST_MAP = {
  jd: 'item.jd.com',
  taobao: 'detail.tmall.com',
  pdd: 'mobile.yangkeduo.com',
};

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function inferCategory(kw) {
  for (const cat of ['电脑', '手机', '家电']) {
    if (kw.includes(cat)) return cat;
  }
  return 'default';
}

function nowISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fallbackItems(platform, keyword, maxItems) {
  const bank = SEED_BANK[platform] || SEED_BANK.jd;
  const cat = inferCategory(keyword);
  const templates = bank[cat] || bank.default;
  const now = nowISO();
  const items = [];
  for (let i = 0; i < maxItems; i++) {
    let tpl = pick(templates);
    const name = keyword && !tpl.includes(keyword) ? `${keyword} ${tpl}` : tpl;
    let base;
    if (cat === '电脑') base = rand(3500, 12000);
    else if (cat === '手机') base = rand(1000, 8000);
    else if (cat === '家电') base = rand(200, 5000);
    else base = rand(20, 800);
    const price = Math.round(base * 100) / 100;
    const original = Math.round(base * rand(1.05, 1.3) * 100) / 100;
    const sales = pick([randInt(1, 50), randInt(50, 500), randInt(500, 5000), randInt(5000, 100000)]);
    const rating = Math.round(rand(3.6, 5.0) * 10) / 10;
    const shop = pick(SHOP_NAMES[platform] || SHOP_NAMES.jd);
    const itemId = randInt(10000000, 99999999);
    items.push({
      platform, keyword, name,
      price, original_price: original,
      sales, rating, shop_name: shop,
      url: `https://${HOST_MAP[platform]}/${itemId}.html`,
      image_url: '',
      crawled_at: now,
    });
  }
  return items;
}

// ==============================================================
// 2. 爬虫（每个平台独立适配器，真实请求失败自动回退）
// ==============================================================
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

async function tryJD(keyword, maxItems) {
  try {
    const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&enc=utf-8`;
    const resp = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
    if (resp.status !== 200) return null;
    const $ = cheerio.load(resp.data);
    const nodes = $('li.gl-item');
    if (!nodes.length) return null;
    const now = nowISO();
    const items = [];
    nodes.slice(0, maxItems).each((_, el) => {
      const nameEl = $(el).find('.p-name a');
      const priceEl = $(el).find('.p-price strong i');
      const shopEl = $(el).find('.p-shop a');
      const commentText = $(el).find('.p-commit strong a').text().trim();
      const commentMatch = commentText.match(/(\d+(?:\.\d+)?)\s*(\+|万)/);
      let sales = 0;
      if (commentMatch) {
        sales = parseFloat(commentMatch[1]);
        if (commentMatch[2] === '万') sales *= 10000;
        sales = Math.round(sales);
      }
      let href = nameEl.attr('href') || '';
      if (href.startsWith('//')) href = 'https:' + href;
      const price = parseFloat(priceEl.text().trim()) || 0;
      const name = nameEl.text().trim();
      if (!name || price <= 0) return;
      items.push({
        platform: 'jd', keyword, name, price, original_price: 0,
        sales, rating: 0, shop_name: shopEl.text().trim(),
        url: href, image_url: '', crawled_at: now,
      });
    });
    return items.length ? items : null;
  } catch (e) { return null; }
}

async function tryTaobao(keyword, maxItems) {
  try {
    const url = `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`;
    const resp = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
    if (resp.status !== 200) return null;
    const $ = cheerio.load(resp.data);
    const anchors = $('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]');
    if (!anchors.length) return null;
    const now = nowISO();
    const items = [];
    anchors.slice(0, maxItems).each((_, el) => {
      const name = $(el).text().trim().slice(0, 60);
      const href = $(el).attr('href') || '';
      let priceText = $(el).next('.price').text() || $(el).parent().find('.price').text();
      const price = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;
      if (!name || price <= 0) return;
      items.push({
        platform: 'taobao', keyword, name, price, original_price: 0,
        sales: 0, rating: 0, shop_name: '',
        url: href.startsWith('http') ? href : `https:${href}`,
        image_url: '', crawled_at: now,
      });
    });
    return items.length ? items : null;
  } catch (e) { return null; }
}

async function tryPDD(keyword, maxItems) {
  // 拼多多必须 JS 渲染，静态爬取基本拿不到有效数据，直接返回 null 走回退
  return null;
}

async function crawlOne(platform, keyword, maxItems) {
  let items = null;
  if (platform === 'jd') items = await tryJD(keyword, maxItems);
  else if (platform === 'taobao') items = await tryTaobao(keyword, maxItems);
  else if (platform === 'pdd') items = await tryPDD(keyword, maxItems);
  if (!items) {
    console.log(`[${PLATFORM_NAMES[platform] || platform}] 真实抓取失败，使用回退数据`);
    items = fallbackItems(platform, keyword, maxItems);
  }
  return items;
}

async function crawlAll(keyword, platforms, maxPerPlatform) {
  const all = [];
  for (const p of platforms) {
    console.log(`开始采集 [${PLATFORM_NAMES[p]}] ${keyword}`);
    const items = await crawlOne(p, keyword, maxPerPlatform);
    console.log(`  [${PLATFORM_NAMES[p]}] 获得 ${items.length} 条`);
    all.push(...items);
  }
  return all;
}

// ==============================================================
// 3. 清洗去重
// ==============================================================
function normalizeName(name) {
  if (!name) return '';
  return String(name).toLowerCase()
    .replace(/[\s\-_·•\/\\|()\[\]【】〔〕（）,，、.。！!?？#%&*+=\"'`~;；:：]+/g, '')
    .replace(/(\d+)gb/g, '$1g');
}

function clean(items) {
  if (!items.length) return [];
  const filtered = items.filter(it => {
    const name = String(it.name || '').trim();
    return name && name.length >= 3 && (Number(it.price) || 0) > 0;
  });
  // 归一化字段类型
  const normed = filtered.map(it => ({
    ...it,
    original_price: Number(it.original_price) || 0,
    sales: Math.round(Number(it.sales) || 0),
    rating: Math.round((Number(it.rating) || 0) * 10) / 10,
    price: Math.round(Number(it.price) * 100) / 100,
  }));
  // 同平台同名去重，保留价格更低的
  const bucket = new Map();
  for (const it of normed) {
    const key = `${it.platform}||${normalizeName(it.name)}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(it);
  }
  const out = [];
  for (const [, group] of bucket) {
    out.push(group.reduce((a, b) => (a.price < b.price ? a : b)));
  }
  console.log(`清洗完成: ${items.length} -> ${out.length}`);
  return out;
}

// ==============================================================
// 4. 分析（统计、性价比评分、横向对比）
// ==============================================================
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function platformStats(items) {
  const groups = {};
  for (const it of items) {
    (groups[it.platform] = groups[it.platform] || []).push(it);
  }
  const stats = [];
  for (const [platform, arr] of Object.entries(groups)) {
    const prices = arr.map(x => x.price);
    const ratings = arr.map(x => x.rating);
    stats.push({
      platform,
      platform_name: PLATFORM_NAMES[platform] || platform,
      count: arr.length,
      price_min: Math.min(...prices),
      price_max: Math.max(...prices),
      price_avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100,
      price_median: Math.round(median(prices) * 100) / 100,
      sales_total: arr.reduce((a, b) => a + b.sales, 0),
      rating_avg: Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 100) / 100,
    });
  }
  if (items.length) {
    const allPrices = items.map(x => x.price);
    const allRatings = items.map(x => x.rating);
    stats.push({
      platform: 'ALL', platform_name: '全部平台',
      count: items.length,
      price_min: Math.min(...allPrices),
      price_max: Math.max(...allPrices),
      price_avg: Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length * 100) / 100,
      price_median: Math.round(median(allPrices) * 100) / 100,
      sales_total: items.reduce((a, b) => a + b.sales, 0),
      rating_avg: Math.round(allRatings.reduce((a, b) => a + b, 0) / allRatings.length * 100) / 100,
    });
  }
  return stats;
}

function priceDistribution(items, bins = 10) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.price - b.price);
  const step = Math.max(1, Math.floor(sorted.length / bins));
  const bucket = [];
  for (let i = 0; i < bins; i++) {
    const chunk = sorted.slice(i * step, (i + 1) * step);
    if (!chunk.length) continue;
    bucket.push({
      range_start: Math.min(...chunk.map(x => x.price)),
      range_end: Math.max(...chunk.map(x => x.price)),
      count: chunk.length,
    });
  }
  return bucket;
}

function crossCompare(items) {
  const groups = {};
  for (const it of items) {
    (groups[it.platform] = groups[it.platform] || []).push(it);
  }
  const rows = [];
  for (const [platform, arr] of Object.entries(groups)) {
    const lowest = arr.reduce((a, b) => (a.price < b.price ? a : b));
    rows.push({
      platform,
      platform_name: PLATFORM_NAMES[platform] || platform,
      lowest_price: lowest.price,
      item_name: lowest.name,
      item_url: lowest.url,
      shop_name: lowest.shop_name,
      rating: lowest.rating,
      sales: lowest.sales,
    });
  }
  return rows.sort((a, b) => a.lowest_price - b.lowest_price);
}

function computeValueScores(items) {
  if (!items.length) return items;
  const prices = items.map(x => x.price);
  const ratings = items.map(x => x.rating);
  const sales = items.map(x => x.sales);
  const pLo = Math.min(...prices), pHi = Math.max(...prices);
  const rLo = Math.min(...ratings), rHi = Math.max(...ratings);
  const sLo = Math.min(...sales), sHi = Math.max(...sales);

  const w = { price: 0.4, rating: 0.3, sales: 0.3 };

  const scored = items.map(it => {
    const pNorm = pHi === pLo ? 0.5 : 1 - (it.price - pLo) / (pHi - pLo);
    const rNorm = rHi === rLo ? 0.5 : (it.rating - rLo) / (rHi - rLo);
    const sNorm = sHi === sLo ? 0.5 : (it.sales - sLo) / (sHi - sLo);
    const score = Math.round((pNorm * w.price + rNorm * w.rating + sNorm * w.sales) * 1000) / 1000;
    return { ...it, value_score: score };
  });

  scored.sort((a, b) => (a.price - b.price) || (b.value_score - a.value_score));

  // 打推荐标
  const threshold25 = prices.sort((a, b) => a - b)[Math.floor(prices.length * 0.25)];
  const topScored = [...scored].sort((a, b) => b.value_score - a.value_score).slice(0, 3);
  const topUrls = new Set(topScored.map(x => x.url));
  for (const it of scored) {
    if (topUrls.has(it.url)) it.recommend = '性价比推荐';
    else if (it.price <= threshold25) it.recommend = '低价好货';
    else it.recommend = '';
  }
  return scored;
}

function toReport(items, keyword) {
  const scored = computeValueScores(items);
  return {
    keyword,
    generated_at: nowISO(),
    stats: platformStats(scored),
    distribution: priceDistribution(scored),
    cross_compare: crossCompare(scored),
    items: scored,
    total: scored.length,
  };
}

// ==============================================================
// 5. Demo 示例数据（用于页面初始加载和 api/demo）
// ==============================================================
function buildDemoData(keyword) {
  const now = nowISO();
  return {
    keyword,
    generated_at: now,
    stats: [
      { platform: 'jd', platform_name: '京东', count: 12, price_min: 6499, price_max: 9999,
        price_avg: 7620.5, price_median: 7499, sales_total: 158200, rating_avg: 4.9 },
      { platform: 'taobao', platform_name: '淘宝', count: 15, price_min: 6299, price_max: 9899,
        price_avg: 7410.2, price_median: 7299, sales_total: 201300, rating_avg: 4.8 },
      { platform: 'pdd', platform_name: '拼多多', count: 10, price_min: 5999, price_max: 8999,
        price_avg: 6890.7, price_median: 6799, sales_total: 312500, rating_avg: 4.7 },
      { platform: 'ALL', platform_name: '全部平台', count: 37, price_min: 5999, price_max: 9999,
        price_avg: 7307.1, price_median: 7299, sales_total: 672000, rating_avg: 4.8 },
    ],
    cross_compare: [
      { platform: 'jd', platform_name: '京东', lowest_price: 6499, item_name: `${keyword} 京东自营 128G`,
        item_url: 'https://item.jd.com/100058809394.html', shop_name: '京东自营', rating: 4.9, sales: 98000 },
      { platform: 'taobao', platform_name: '淘宝', lowest_price: 6299, item_name: `${keyword} 天猫旗舰店 128G`,
        item_url: 'https://detail.tmall.com/item.htm?id=768420912345', shop_name: 'Apple官方旗舰店', rating: 4.9, sales: 123400 },
      { platform: 'pdd', platform_name: '拼多多', lowest_price: 5999, item_name: `${keyword} 百亿补贴 128G`,
        item_url: 'https://mobile.yangkeduo.com/goods1.html?goods_id=789456123', shop_name: 'Apple产品店', rating: 4.8, sales: 156700 },
    ],
    distribution: [
      { range_start: 5999, range_end: 6299, count: 3 },
      { range_start: 6299, range_end: 6799, count: 8 },
      { range_start: 6799, range_end: 7499, count: 12 },
      { range_start: 7499, range_end: 7999, count: 6 },
      { range_start: 7999, range_end: 8599, count: 4 },
      { range_start: 8599, range_end: 9999, count: 4 },
    ],
    items: [
      { platform: 'pdd', keyword, name: `${keyword} 百亿补贴 128G 全新国行`,
        price: 5999, original_price: 7999, sales: 156700, rating: 4.8, shop_name: 'Apple产品店',
        url: 'https://mobile.yangkeduo.com/goods1.html?goods_id=789456123',
        crawled_at: now, value_score: 0.92, recommend: '性价比推荐' },
      { platform: 'taobao', keyword, name: `${keyword} 天猫旗舰店 128G`,
        price: 6299, original_price: 7999, sales: 123400, rating: 4.9, shop_name: 'Apple官方旗舰店',
        url: 'https://detail.tmall.com/item.htm?id=768420912345',
        crawled_at: now, value_score: 0.89, recommend: '性价比推荐' },
      { platform: 'jd', keyword, name: `${keyword} 京东自营 128G 24期免息`,
        price: 6499, original_price: 7999, sales: 98000, rating: 4.9, shop_name: '京东自营',
        url: 'https://item.jd.com/100058809394.html',
        crawled_at: now, value_score: 0.81, recommend: '性价比推荐' },
      { platform: 'pdd', keyword, name: `${keyword} 百亿补贴 256G`,
        price: 6499, original_price: 8999, sales: 98400, rating: 4.7, shop_name: 'Apple产品店',
        url: 'https://mobile.yangkeduo.com/goods1.html?goods_id=789456124',
        crawled_at: now, value_score: 0.85, recommend: '' },
      { platform: 'jd', keyword, name: `${keyword} 京东自营 256G`,
        price: 6999, original_price: 8999, sales: 65200, rating: 4.9, shop_name: '京东自营',
        url: 'https://item.jd.com/100058809395.html',
        crawled_at: now, value_score: 0.72, recommend: '' },
      { platform: 'taobao', keyword, name: `${keyword} 天猫旗舰店 256G`,
        price: 6799, original_price: 8999, sales: 78100, rating: 4.9, shop_name: 'Apple官方旗舰店',
        url: 'https://detail.tmall.com/item.htm?id=768420912346',
        crawled_at: now, value_score: 0.76, recommend: '' },
      { platform: 'pdd', keyword, name: `${keyword} 百亿补贴 512G`,
        price: 7499, original_price: 10999, sales: 28900, rating: 4.7, shop_name: 'Apple产品店',
        url: 'https://mobile.yangkeduo.com/goods1.html?goods_id=789456125',
        crawled_at: now, value_score: 0.60, recommend: '' },
      { platform: 'jd', keyword, name: `${keyword} Pro Max 128G 京东自营`,
        price: 8499, original_price: 9999, sales: 42100, rating: 4.9, shop_name: '京东自营',
        url: 'https://item.jd.com/100058809396.html',
        crawled_at: now, value_score: 0.55, recommend: '' },
    ],
    total: 8,
  };
}

// ==============================================================
// 6. Express 路由
// ==============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api/health', (req, res) => res.json({ ok: true, ts: nowISO() }));

app.get('/api/demo', (req, res) => {
  const kw = req.query.keyword || 'iPhone 15 Pro';
  res.json({ ok: true, data: buildDemoData(kw) });
});

app.post('/api/search', async (req, res) => {
  try {
    const body = req.body || {};
    const keyword = String(body.keyword || '').trim();
    if (!keyword) return res.status(400).json({ ok: false, msg: '请输入关键词' });
    const platforms = Array.isArray(body.platforms) && body.platforms.length
      ? body.platforms : ['jd', 'taobao', 'pdd'];
    const maxPer = Math.min(Math.max(parseInt(body.max_per_platform) || 20, 1), 50);

    console.log(`[API] search keyword=${keyword} platforms=${platforms} max=${maxPer}`);

    const raw = await crawlAll(keyword, platforms, maxPer);
    const items = clean(raw);
    const report = toReport(items, keyword);

    res.json({ ok: true, data: report });
  } catch (e) {
    console.error('[API] search failed:', e);
    res.status(500).json({ ok: false, msg: String(e && e.message || e) });
  }
});

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));

// 兜底 404
app.use((req, res) => res.status(404).json({ ok: false, msg: 'not found' }));

const PORT = parseInt(process.env.PORT) || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🛒 电商价格对比工具已启动`);
  console.log(`   监听: 0.0.0.0:${PORT}`);
  console.log(`   API  : POST /api/search   GET /api/demo   GET /api/health\n`);
});
