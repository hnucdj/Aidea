/**
 * 电商价格采集 Node.js 后端 - v2
 * 特性: 代理 IP 池 + 多策略抓取 + 真实/回退透明标注
 * 环境变量:
 *   PROXY_URL     单个代理 URL (e.g. http://user:pass@ip:port)
 *   PROXY_LIST    多个代理，逗号分隔
 *   PROXY_ENABLE  "false" 时关闭代理池（默认开启）
 */
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

// 代理支持（优雅降级：没装 https-proxy-agent 就用原生）
let HttpsProxyAgent, HttpProxyAgent;
try {
  const mod = require('https-proxy-agent');
  HttpsProxyAgent = mod.HttpsProxyAgent;
  HttpProxyAgent = mod.HttpProxyAgent || mod.HttpsProxyAgent;
} catch (e) {
  HttpsProxyAgent = null;
  HttpProxyAgent = null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PLATFORM_NAMES = { jd: '京东', taobao: '淘宝', pdd: '拼多多' };
const PLATFORM_COLORS = { jd: '#E1251B', taobao: '#FF6A00', pdd: '#E02E24' };

// ==============================================================
// 0. 代理池管理器
// ==============================================================
class ProxyPool {
  constructor() {
    this.list = [];         // [{url, ok, failCount, lastCheck, latency}]
    this.fetchAt = 0;
    this.enabled = process.env.PROXY_ENABLE !== 'false';
    this.lockUrl = process.env.PROXY_URL;
    if (this.lockUrl) {
      this.list.push({ url: this.lockUrl.replace(/^https?:\/\//, 'http://'), ok: true, failCount: 0, latency: 0 });
      this.fetchAt = Date.now();
    }
    this.lockList = (process.env.PROXY_LIST || '')
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(u => u.replace(/^https?:\/\//, 'http://'));
    for (const u of this.lockList) {
      if (!this.list.some(x => x.url === u)) this.list.push({ url: u, ok: true, failCount: 0, latency: 0 });
      this.fetchAt = Date.now();
    }
    this.stats = { totalReq: 0, proxyHits: 0, proxyOk: 0, proxyFail: 0 };
  }

  async refresh(force = false) {
    if (!this.enabled) return this;
    const CACHE_MS = 30 * 60 * 1000;
    if (this.lockUrl || this.lockList.length) return this;
    // 已有足够可用代理且未过期 → 跳过
    const ok = this.list.filter(x => x.ok);
    if (!force && ok.length >= 15 && Date.now() - this.fetchAt < CACHE_MS) return this;
    // 首次启动 → 用内置代理（秒回！不走网络）
    if (!force && this.list.length === 0) {
      const builtin = [
        'http://45.168.244.16:8080', 'http://124.217.109.153:8082',
        'http://103.167.66.182:8088', 'http://45.174.248.23:999',
        'http://102.38.7.149:18000', 'http://36.92.149.235:8080',
        'http://160.251.172.183:3128', 'http://139.5.75.83:8080',
        'http://103.227.187.193:6080', 'http://156.230.176.245:8080',
        'http://223.25.100.42:2222', 'http://189.51.168.164:999',
        'http://177.184.195.168:8080', 'http://45.225.89.145:999',
        'http://129.151.130.247:1111', 'http://181.129.16.218:8080',
        'http://103.20.108.51:8080', 'http://131.196.13.233:999',
        'http://180.191.2.165:8081', 'http://203.175.103.25:3125',
        'http://45.161.128.36:8080', 'http://103.189.223.38:8080',
        'http://36.92.199.158:8080', 'http://185.147.157.135:3128',
        'http://217.28.220.182:3128', 'http://84.55.46.85:8080',
        'http://3.224.26.242:80',     'http://163.172.167.48:80',
        'http://103.153.247.74:8080', 'http://49.0.26.97:8080',
      ];
      this.list = builtin.map(url => ({ url, ok: true, failCount: 0, latency: 0, lastCheck: Date.now() }));
      this.fetchAt = Date.now();
      console.log(`[ProxyPool] 内置 ${this.list.length} 个代理（快速启动）`);
      setImmediate(() => this._refreshAsync()); // 异步增量刷新
      return this;
    }
    await this._refreshAsync();
    return this;
  }

  async _refreshAsync() {
    try {
      const sources = ['https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', 'https://spys.me/proxy.txt'];
      const all = new Set();
      for (const src of sources) {
        try {
          const r = await axios.get(src, { timeout: 4000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          (r.data.match(/(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}/g) || []).forEach(ip => all.add('http://' + ip));
        } catch (e) { /* 源超时跳过 */ }
      }
      const seen = new Set(this.list.map(x => x.url));
      const fresh = [...all].filter(u => !seen.has(u)).slice(0, 15);
      if (!fresh.length) { this.fetchAt = Date.now(); return; }
      const tested = await Promise.all(fresh.map(url => this.test(url)));
      const ok = tested.filter(x => x.ok);
      if (ok.length) {
        this.list = [...this.list, ...ok].slice(0, 500);
        console.log(`[ProxyPool] 异步刷新 +${ok.length}`);
      }
      this.fetchAt = Date.now();
    } catch (e) { /* 忽略异步错误 */ }
  }

  async test(url) {
    const t0 = Date.now();
    try {
      const agent = new (HttpsProxyAgent || HttpProxyAgent)(url, { timeout: 3000 });
      const r = await axios.get('https://www.baidu.com/', {
        httpsAgent: agent, httpAgent: agent, timeout: 3500, maxRedirects: 2,
      });
      if (r.data && r.data.includes('<html')) {
        return { url, ok: true, failCount: 0, latency: Date.now() - t0, lastCheck: Date.now() };
      }
    } catch (e) { /* ignore */ }
    return { url, ok: false, failCount: (this.list.find(x => x.url === url)?.failCount || 0) + 1, latency: 0, lastCheck: Date.now() };
  }

  pickN(n) {
    const ok = this.list.filter(x => x.ok).sort((a, b) => a.failCount - b.failCount);
    const picked = [];
    for (const item of ok) {
      if (picked.length >= n) break;
      picked.push(item.url);
    }
    return picked;
  }

  report(url, success) {
    const item = this.list.find(x => x.url === url);
    if (item) {
      item.ok = success;
      item.failCount = success ? 0 : item.failCount + 1;
      item.lastCheck = Date.now();
      if (success) this.stats.proxyOk++; else this.stats.proxyFail++;
    }
  }

  get status() {
    const okCount = this.list.filter(x => x.ok).length;
    const failCount = this.list.filter(x => !x.ok).length;
    return {
      enabled: this.enabled,
      lockUrl: !!this.lockUrl,
      lockListCount: this.lockList.length,
      totalCount: this.list.length,
      okCount, failCount,
      fetchedAt: new Date(this.fetchAt).toISOString(),
      stats: this.stats,
      sample: this.list.filter(x => x.ok).slice(0, 5).map(x => ({ url: x.url, latency: x.latency })),
    };
  }
}

const PROXY = new ProxyPool();

/**
 * 带代理的 HTTP 请求 —— 先直连(3s)，直连失败/空壳再用代理(2.5s×2)，整体 < 8s
 * 反爬检测：body 短 / 含风控关键词 → 视为失败，换代理
 */
const RISK_KEYWORDS = ['京东验证', 'risk/shields', 'probe.js', 'captcha', 'verify/safety',
                       '反爬虫', '访问验证', '人机验证', 'safedns'];

function isRiskyBody(body) {
  if (!body) return true;
  if (body.length < 800) return true;
  for (const kw of RISK_KEYWORDS) if (body.includes(kw)) return true;
  // 返回 JSON 但不是商品数据
  if (body.trim().startsWith('{') && body.length < 2000) return true;
  return false;
}

async function proxiedRequest(url, opts = {}) {
  PROXY.stats.totalReq++;
  await PROXY.refresh();

  const maxProxies = opts.maxProxies || 2;
  const DIRECT_TIMEOUT = 3000;
  const PROXY_TIMEOUT = 2500;

  // —— 阶段 1: 直连（快速返回，直连被风控的电商会 200 但 body 是空壳 → 立即识别）——
  try {
    const r = await axios.get(url, { ...opts, timeout: DIRECT_TIMEOUT, maxRedirects: 5 });
    const body = String(r.data || '');
    if (!isRiskyBody(body)) {
      return { ...r, _proxy: null, _viaProxy: false };
    }
    // 直连返回风控页 → 标记为一次失败，继续代理
  } catch (e) { /* 直连网络错误 → 走代理 */ }

  // —— 阶段 2: 代理池兜底（2 个代理，各 2.5s）——
  const proxies = PROXY.pickN(maxProxies);
  for (const pUrl of proxies) {
    try {
      PROXY.stats.proxyHits++;
      const agent = new (HttpsProxyAgent || HttpProxyAgent)(pUrl, { timeout: PROXY_TIMEOUT });
      const r = await axios.get(url, {
        ...opts, httpsAgent: agent, httpAgent: agent,
        timeout: PROXY_TIMEOUT, maxRedirects: 5,
      });
      const body = String(r.data || '');
      if (r.status === 200 && !isRiskyBody(body)) {
        PROXY.report(pUrl, true);
        return { ...r, _proxy: pUrl, _viaProxy: true };
      }
      // 代理也返回空壳 → 换下一个
      PROXY.report(pUrl, false);
    } catch (e) {
      PROXY.report(pUrl, false);
    }
  }

  // —— 全部失败: 直连再试一次给最长 timeout ——
  try {
    const r = await axios.get(url, { ...opts, timeout: 5000, maxRedirects: 5 });
    return { ...r, _proxy: null, _viaProxy: false, _lastTry: true };
  } catch (e) {
    throw e;
  }
}

// ==============================================================
// 1. 种子库（真实爬虫彻底失败时才用）
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
  for (const cat of ['电脑', '手机', '家电', '相机', '耳机']) if (kw.includes(cat)) return cat;
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
      platform, keyword, name, price, original_price: original,
      sales, rating, shop_name: shop,
      url: `https://${HOST_MAP[platform]}/${itemId}.html`,
      image_url: '', crawled_at: now, _source: 'fallback',
    });
  }
  return items;
}

// ==============================================================
// 2. 爬虫（每个平台独立适配器，先代理后直连，失败才回退）
// ==============================================================
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
                  'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

async function tryJD(keyword, maxItems) {
  const urls = [
    { url: `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&enc=utf-8`,
      headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://www.jd.com/' },
      kind: 'pc' },
    { url: `https://so.m.jd.com/ware/search.action?keyword=${encodeURIComponent(keyword)}&page=1`,
      headers: { 'User-Agent': MOBILE_UA, 'Referer': 'https://m.jd.com/' },
      kind: 'mobile' },
  ];

  for (const { url, headers, kind } of urls) {
    try {
      const resp = await proxiedRequest(url, { headers });
      if (resp.status !== 200) continue;
      const body = String(resp.data || '');
      // 反爬检测
      if (body.includes('京东验证') || body.includes('risk/shields') || body.length < 500) continue;

      let $ = cheerio.load(body);
      let nodes = $('li.gl-item');
      if (!nodes.length) nodes = $('.ware-item, .ware-list-item');
      if (!nodes.length) {
        // 再试商品 JSON
        const initMatch = body.match(/window\.__INIT__\s*=\s*({[\s\S]{200,20000}})/);
        if (initMatch) {
          try {
            const data = JSON.parse(initMatch[1]);
            const list = (data.data?.wareList || data.data?.ware_list || []).slice(0, maxItems);
            if (list.length) {
              const now = nowISO();
              return list.map(w => ({
                platform: 'jd', keyword,
                name: w.wname || w.name || w.wareName || '',
                price: parseFloat(w.price || w.p_price || 0) || 0,
                original_price: parseFloat(w.oprice || 0) || 0,
                sales: Math.round(Number(w.comment_num || 0) || 0),
                rating: 0,
                shop_name: w.shopName || w.shop_name || '',
                url: w.skuId ? `https://item.jd.com/${w.skuId}.html` : (w.url || ''),
                image_url: w.image || w.img || '',
                crawled_at: now, _source: 'real', _proxy: resp._proxy,
              })).filter(x => x.name && x.price > 0);
            }
          } catch (e) { /* ignore */ }
        }
        continue;
      }

      const now = nowISO();
      const items = [];
      nodes.slice(0, maxItems).each((_, el) => {
        const nameEl = $(el).find('.p-name a, .p-name em, .ware-name');
        const priceEl = $(el).find('.p-price strong i, .price-box .p-price');
        const shopEl = $(el).find('.p-shop a, .item-shop-name');
        const commentText = $(el).find('.p-commit strong a').text().trim();
        let sales = 0;
        const commentMatch = commentText.match(/(\d+(?:\.\d+)?)\s*(万|\+)/);
        if (commentMatch) {
          sales = parseFloat(commentMatch[1]);
          if (commentMatch[2] === '万') sales *= 10000;
          sales = Math.round(sales);
        }
        let href = (nameEl.attr('href') || '').trim();
        if (href.startsWith('//')) href = 'https:' + href;
        const priceText = priceEl.text().trim().replace(/[^\d.]/g, '');
        const price = parseFloat(priceText) || 0;
        const name = nameEl.text().trim();
        if (!name || price <= 0) return;
        items.push({
          platform: 'jd', keyword, name, price, original_price: 0,
          sales, rating: 0, shop_name: shopEl.text().trim(),
          url: href, image_url: '', crawled_at: now,
          _source: 'real', _proxy: resp._proxy,
        });
      });
      if (items.length) {
        console.log(`  [JD ${kind}] 真实抓取 ${items.length} 条 via ${resp._proxy || 'DIRECT'}`);
        return items;
      }
    } catch (e) { /* 换下一 URL */ }
  }
  return null;
}

async function tryTaobao(keyword, maxItems) {
  const urls = [
    { url: `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}&s=0&imgfile=&commend=all&ssid=s5-e&search_type=item&sourceId=tb.index`,
      headers: { 'User-Agent': DEFAULT_UA, 'Referer': 'https://www.taobao.com/' } },
    { url: `https://s.m.taobao.com/h5?q=${encodeURIComponent(keyword)}&search=提交&style=list`,
      headers: { 'User-Agent': MOBILE_UA } },
    { url: `https://h5api.m.taobao.com/h5/mtop.wdetail.sampleitem.find/1.0/?data=${encodeURIComponent(JSON.stringify({ keyword, pageSize: maxItems, pageNum: 1 }))}`,
      headers: { 'User-Agent': MOBILE_UA } },
  ];

  for (const { url, headers } of urls) {
    try {
      const resp = await proxiedRequest(url, { headers });
      if (resp.status !== 200) continue;
      const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      if (body.includes('captcha') && body.includes('timeout')) continue;

      // 淘宝新版 JSON (__INIT_DATA__)
      const initMatch = body.match(/window\.__INIT_DATA__\s*=\s*(\{[\s\S]{200,200000}\});/);
      if (initMatch) {
        try {
          const data = JSON.parse(initMatch[1]);
          const itemList = data.modItems?.['3397598792410']?.list ||
                           data.data?.resultList || [];
          const list = itemList.filter(x => x && x.itemId).slice(0, maxItems);
          if (list.length) {
            const now = nowISO();
            return list.map(x => ({
              platform: 'taobao', keyword,
              name: (x.rawTitle || x.title || '').replace(/<[^>]+>/g, '').slice(0, 80),
              price: parseFloat(x.priceWap || x.price || 0) || 0,
              original_price: parseFloat(x.price || 0) || 0,
              sales: Math.round(Number(x.payNum || 0) || 0),
              rating: 0,
              shop_name: x.shopName || '',
              url: x.detailUrl ? (x.detailUrl.startsWith('http') ? x.detailUrl : `https:${x.detailUrl}`) : `https://detail.tmall.com/item.htm?id=${x.itemId}`,
              image_url: x.picUrl ? (x.picUrl.startsWith('//') ? `https:${x.picUrl}` : x.picUrl) : '',
              crawled_at: now, _source: 'real', _proxy: resp._proxy,
            })).filter(x => x.name && x.price > 0);
          }
        } catch (e) {}
      }

      // 老版 g_page_config
      const cfgMatch = body.match(/g_page_config\s*=\s*(\{[\s\S]{200,50000}\})/);
      if (cfgMatch) {
        try {
          const cfg = JSON.parse(cfgMatch[1]);
          const itemList = cfg.mods?.['itemlist']?.data?.auctions || [];
          if (itemList.length) {
            const now = nowISO();
            return itemList.slice(0, maxItems).map(a => ({
              platform: 'taobao', keyword,
              name: (a.raw_title || a.title || '').slice(0, 80),
              price: parseFloat(a.view_price || 0) || 0,
              original_price: parseFloat(a.view_original_price || 0) || 0,
              sales: Math.round(Number(a.pay_num || 0) || 0),
              rating: 0,
              shop_name: a.shop_nick || '',
              url: a.detail_url || `https://detail.tmall.com/item.htm?id=${a.item_id}`,
              image_url: a.pic_url || '',
              crawled_at: now, _source: 'real', _proxy: resp._proxy,
            })).filter(x => x.name && x.price > 0);
          }
        } catch (e) {}
      }

      // HTML DOM 兜底
      const $ = cheerio.load(body);
      const anchors = $('a[href*="item.taobao.com"], a[href*="detail.tmall.com"], [class*="Card--doubleCard"]');
      if (anchors.length >= 3) {
        const now = nowISO();
        const items = [];
        anchors.slice(0, maxItems).each((_, el) => {
          const name = $(el).text().trim().slice(0, 60);
          const href = $(el).attr('href') || '';
          const priceText = $(el).find('[class*="price"]').first().text().trim();
          const price = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;
          if (!name || price <= 0) return;
          items.push({
            platform: 'taobao', keyword, name, price, original_price: 0,
            sales: 0, rating: 0, shop_name: '',
            url: href.startsWith('http') ? href : `https:${href}`,
            image_url: '', crawled_at: now,
            _source: 'real', _proxy: resp._proxy,
          });
        });
        if (items.length >= 2) {
          console.log(`  [Taobao HTML] 真实抓取 ${items.length} 条 via ${resp._proxy || 'DIRECT'}`);
          return items;
        }
      }
    } catch (e) { /* next */ }
  }
  return null;
}

async function tryPDD(keyword, maxItems) {
  const urls = [
    { url: `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(keyword)}`,
      headers: { 'User-Agent': MOBILE_UA } },
  ];
  for (const { url, headers } of urls) {
    try {
      const resp = await proxiedRequest(url, { headers });
      if (resp.status !== 200) continue;
      const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      if (body.includes('probe.js') || body.includes('captcha')) continue;

      // PDD 通常把数据塞 window 里
      const rawMatch = body.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]{200,200000}\})/);
      if (rawMatch) {
        try {
          const data = JSON.parse(rawMatch[1]);
          const items = (data.goodsList || data.list || data.items || []).slice(0, maxItems);
          if (items.length) {
            const now = nowISO();
            return items.map(g => ({
              platform: 'pdd', keyword,
              name: g.goods_name || g.title || g.name || '',
              price: parseFloat(g.min_normal_price || g.price || 0) / 100 || 0,
              original_price: parseFloat(g.market_price || g.price || 0) / 100 || 0,
              sales: Math.round(Number(g.cnt || g.sales || 0) || 0),
              rating: 0,
              shop_name: g.mall_name || '',
              url: `https://mobile.yangkeduo.com/goods1.html?goods_id=${g.goods_id || g.goodsId || ''}`,
              image_url: g.thumb_url || g.image_url || '',
              crawled_at: now, _source: 'real', _proxy: resp._proxy,
            })).filter(x => x.name && x.price > 0);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return null;
}

async function crawlOne(platform, keyword, maxItems) {
  // 平台级封顶：4s 超时直接放弃真实抓取 —— 防止远程网络卡住 TCP
  const TIMEOUT_MS = 4000;
  const realPromise = (async () => {
    if (platform === 'jd') return tryJD(keyword, maxItems);
    if (platform === 'taobao') return tryTaobao(keyword, maxItems);
    if (platform === 'pdd') return tryPDD(keyword, maxItems);
    return null;
  })();
  const timeoutPromise = new Promise(r => setTimeout(() => r(null), TIMEOUT_MS));
  let items = await Promise.race([realPromise, timeoutPromise]);

  if (!items || !items.length) {
    console.log(`  [${PLATFORM_NAMES[platform] || platform}] 真实抓取失败(${items === null ? '超时/网络' : '无匹配'})，使用回退数据`);
    return fallbackItems(platform, keyword, maxItems);
  }
  items.forEach(it => { if (!it._source) it._source = 'real'; });
  return items;
}

async function crawlAll(keyword, platforms, maxPerPlatform) {
  // 并行抓取 —— 每个平台 < 8s，总耗时 < 10s
  const results = await Promise.all(platforms.map(async p => {
    console.log(`[crawl] ${PLATFORM_NAMES[p]} keyword=${keyword} max=${maxPerPlatform}`);
    const items = await crawlOne(p, keyword, maxPerPlatform);
    const realCount = items.filter(x => x._source === 'real').length;
    const fbCount = items.filter(x => x._source === 'fallback').length;
    console.log(`  [${PLATFORM_NAMES[p]}] 总计 ${items.length} 条 (real=${realCount}, fallback=${fbCount})`);
    return items;
  }));
  return results.flat();
}

// ==============================================================
// 3. 清洗去重 + 分析（和 v1 一致，不重复）
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
  const normed = filtered.map(it => ({
    ...it,
    original_price: Number(it.original_price) || 0,
    sales: Math.round(Number(it.sales) || 0),
    rating: Math.round((Number(it.rating) || 0) * 10) / 10,
    price: Math.round(Number(it.price) * 100) / 100,
  }));
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
  console.log(`[clean] ${items.length} -> ${out.length}`);
  return out;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function platformStats(items) {
  const groups = {};
  for (const it of items) (groups[it.platform] = groups[it.platform] || []).push(it);
  const stats = [];
  for (const [platform, arr] of Object.entries(groups)) {
    const prices = arr.map(x => x.price);
    stats.push({
      platform, platform_name: PLATFORM_NAMES[platform] || platform,
      count: arr.length,
      price_min: Math.min(...prices), price_max: Math.max(...prices),
      price_avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100,
      price_median: Math.round(median(prices) * 100) / 100,
      sales_total: arr.reduce((a, b) => a + b.sales, 0),
      rating_avg: Math.round(arr.reduce((a, b) => a + b.rating, 0) / arr.length * 100) / 100,
    });
  }
  if (items.length) {
    const ap = items.map(x => x.price), ar = items.map(x => x.rating);
    stats.push({
      platform: 'ALL', platform_name: '全部平台',
      count: items.length,
      price_min: Math.min(...ap), price_max: Math.max(...ap),
      price_avg: Math.round(ap.reduce((a, b) => a + b, 0) / ap.length * 100) / 100,
      price_median: Math.round(median(ap) * 100) / 100,
      sales_total: items.reduce((a, b) => a + b.sales, 0),
      rating_avg: Math.round(ar.reduce((a, b) => a + b, 0) / ar.length * 100) / 100,
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
  for (const it of items) (groups[it.platform] = groups[it.platform] || []).push(it);
  const rows = [];
  for (const [platform, arr] of Object.entries(groups)) {
    const lowest = arr.reduce((a, b) => (a.price < b.price ? a : b));
    rows.push({
      platform, platform_name: PLATFORM_NAMES[platform] || platform,
      lowest_price: lowest.price,
      item_name: lowest.name,
      item_url: lowest.url,
      shop_name: lowest.shop_name,
      rating: lowest.rating, sales: lowest.sales,
      source: lowest._source || 'real',
    });
  }
  return rows.sort((a, b) => a.lowest_price - b.lowest_price);
}

function computeValueScores(items) {
  if (!items.length) return items;
  const prices = items.map(x => x.price), ratings = items.map(x => x.rating), sales = items.map(x => x.sales);
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

  const realItems = scored.filter(x => x._source === 'real');
  const baselineSet = realItems.length ? realItems : scored;
  const threshold25 = [...baselineSet].sort((a, b) => a.price - b.price)[Math.floor(baselineSet.length * 0.25)]?.price || 0;
  const topScored = [...baselineSet].sort((a, b) => b.value_score - a.value_score).slice(0, 3);
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
  const realCount = scored.filter(x => x._source === 'real').length;
  const fbCount = scored.filter(x => x._source === 'fallback').length;
  return {
    keyword, generated_at: nowISO(),
    stats: platformStats(scored),
    distribution: priceDistribution(scored),
    cross_compare: crossCompare(scored),
    items: scored, total: scored.length,
    data_source: {
      real_count: realCount,
      fallback_count: fbCount,
      is_reliable: realCount > 0,
      real_ratio: scored.length ? Math.round(realCount / scored.length * 100) : 0,
      note: realCount > 0
        ? `共 ${scored.length} 条数据，其中 ${realCount} 条真实抓取，${fbCount} 条因平台风控回退`
        : `⚠️ 本次 ${keyword} 的 3 个电商平台全部触发反爬风控，所有 ${scored.length} 条为种子库回退数据。若需真实数据，请配置商用代理（环境变量 PROXY_URL）。`,
    },
  };
}

function buildDemoData(keyword) {
  const base = {
    jd:     { shop: '京东自营',    host: 'item.jd.com',  sku: '100058809394' },
    taobao: { shop: 'Apple官方旗舰店', host: 'detail.tmall.com', id: '768420912345' },
    pdd:    { shop: 'Apple产品店',  host: 'mobile.yangkeduo.com', goodsId: '789456123' },
  };
  const now = nowISO();
  const items = [
    { platform: 'pdd',     price: 5999, shop: 'Apple产品店',       name: `${keyword} 百亿补贴 128G 全新国行` },
    { platform: 'taobao', price: 6299, shop: 'Apple官方旗舰店',   name: `${keyword} 天猫旗舰店 128G` },
    { platform: 'jd',     price: 6499, shop: '京东自营',          name: `${keyword} 京东自营 128G 24期免息` },
    { platform: 'pdd',     price: 6499, shop: 'Apple产品店',       name: `${keyword} 百亿补贴 256G` },
    { platform: 'taobao', price: 6799, shop: 'Apple官方旗舰店',   name: `${keyword} 天猫旗舰店 256G` },
    { platform: 'jd',     price: 6999, shop: '京东自营',          name: `${keyword} 京东自营 256G` },
    { platform: 'pdd',     price: 7499, shop: 'Apple产品店',       name: `${keyword} 百亿补贴 512G` },
    { platform: 'jd',     price: 8499, shop: '京东自营',          name: `${keyword} Pro Max 128G 京东自营` },
  ];
  const out = items.map((it, i) => ({
    platform: it.platform, keyword, name: it.name,
    price: it.price, original_price: Math.round(it.price * 1.25 * 100) / 100,
    sales: [156700, 123400, 98000, 98400, 78100, 65200, 28900, 42100][i],
    rating: [4.8, 4.9, 4.9, 4.7, 4.9, 4.9, 4.7, 4.9][i],
    shop_name: it.shop,
    url: it.platform === 'jd'
      ? `https://item.jd.com/${100000000000 + i}.html`
      : it.platform === 'taobao'
        ? `https://detail.tmall.com/item.htm?id=${768420912300 + i}`
        : `https://mobile.yangkeduo.com/goods1.html?goods_id=${789456120 + i}`,
    crawled_at: now, _source: 'demo', recommend: '',
  }));
  return toReport(out, keyword);
}

// ==============================================================
// 4. Express 路由
// ==============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: nowISO(), proxy: PROXY.status }));

app.get('/api/proxy', async (req, res) => {
  // 不强制刷新，返回当前状态即可
  res.json({ ok: true, data: PROXY.status });
});

app.get('/api/demo', (req, res) => {
  const kw = req.query.keyword || 'iPhone 15 Pro';
  res.json({ ok: true, data: buildDemoData(kw), demo: true });
});

app.post('/api/search', async (req, res) => {
  const body = req.body || {};
  const keyword = String(body.keyword || '').trim();
  if (!keyword) return res.status(400).json({ ok: false, msg: '请输入关键词' });
  const platforms = Array.isArray(body.platforms) && body.platforms.length
    ? body.platforms : ['jd', 'taobao', 'pdd'];
  const maxPer = Math.min(Math.max(parseInt(body.max_per_platform) || 20, 1), 50);

  console.log(`\n===== /api/search keyword="${keyword}" platforms=${platforms} max=${maxPer} =====`);
  console.log(`ProxyPool: ${PROXY.status.totalCount} 个代理，有效 ${PROXY.status.okCount}`);

  try {
    const raw = await crawlAll(keyword, platforms, maxPer);
    const items = clean(raw);
    const report = toReport(items, keyword);
    report.proxy_info = PROXY.status;
    res.json({ ok: true, data: report });
  } catch (e) {
    console.error('[search failed]', e);
    res.status(500).json({ ok: false, msg: String(e && e.message || e) });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, msg: 'not found' }));

const PORT = parseInt(process.env.PORT) || 8000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🛒 电商价格对比工具 v2.1（代理池+并行版）已启动`);
  console.log(`   监听: 0.0.0.0:${PORT}`);
  console.log(`   API  : POST /api/search   GET /api/demo   GET /api/health   GET /api/proxy`);
  console.log(`   代理 : ${PROXY.enabled ? '开启（内置 30 + 异步增量刷新）' : '关闭'}`);
  console.log(`   手动代理: ${process.env.PROXY_URL || '未配置（可选 PROXY_URL / PROXY_LIST 环境变量）'}`);
  // 启动时先初始化代理池 —— 内置 30 个秒回
  try {
    await PROXY.refresh();
    console.log(`   代理池就绪: 共 ${PROXY.status.totalCount} 个，可用 ${PROXY.status.okCount}`);
  } catch (e) { /* ignore */ }
  console.log('');
});
