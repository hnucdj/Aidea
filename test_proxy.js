const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const cheerio = require('cheerio');

(async () => {
  const proxy = '45.168.244.16:8080';
  const agent = new HttpsProxyAgent('http://' + proxy);
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  console.log('=== Taobao via ' + proxy + ' ===');
  const tb = await axios.get('https://s.taobao.com/search?q=' + encodeURIComponent('九阳破壁机'), {
    httpsAgent: agent, httpAgent: agent,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://www.taobao.com/' },
    timeout: 15000,
  });
  console.log('size:', tb.data.length, 'status:', tb.status);
  console.log('has __INIT_DATA__:', tb.data.includes('__INIT_DATA__'));
  console.log('has itemlist:', tb.data.includes('itemlist'));
  console.log('has g_page_config:', tb.data.includes('g_page_config'));
  console.log('has spuId:', tb.data.includes('spuId'));
  console.log('has raw JSON:', /window\.__INITIAL_DATA__/.test(tb.data));

  // itemId 数量
  const itemIds = (tb.data.match(/"itemId"\s*:\s*"?\d+/g) || []);
  console.log('itemId:', itemIds.length, itemIds.slice(0,5).join(', '));

  const title = cheerio.load(tb.data)('title').text();
  console.log('title:', title);
  console.log('scripts:', cheerio.load(tb.data)('script').length);

  // 看商品结构
  const $ = cheerio.load(tb.data);
  console.log('.item:', $('.item').length, '.Card:', $('[class*=Card]').length, '.feed-item:', $('.feed-item').length);
  console.log('contains "九阳":', tb.data.includes('九阳'));

  // 保存到文件便于手动看
  require('fs').writeFileSync('/tmp/tb_proxy.html', tb.data);
  console.log('saved to /tmp/tb_proxy.html');

  // === 也试 JD mobile ===
  console.log('\n=== JD mobile via proxy ===');
  try {
    const jdm = await axios.get('https://so.m.jd.com/ware/search.action?keyword=' + encodeURIComponent('九阳破壁机'), {
      httpsAgent: agent, httpAgent: agent,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer': 'https://m.jd.com/' },
      timeout: 15000,
    });
    console.log('JD mobile size:', jdm.data.length);
    console.log('京东验证:', jdm.data.includes('京东验证'));
    console.log('ware-item:', cheerio.load(jdm.data)('.ware-item').length);
    console.log('title:', cheerio.load(jdm.data)('title').text());
  } catch(e) { console.log('JD ERR:', e.message); }

  // === PDD ===
  console.log('\n=== PDD via proxy ===');
  try {
    const pdd = await axios.get('https://mobile.yangkeduo.com/search_result.html?search_key=' + encodeURIComponent('九阳破壁机'), {
      httpsAgent: agent, httpAgent: agent,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      timeout: 15000,
    });
    console.log('PDD size:', pdd.data.length);
    console.log('probe.js:', pdd.data.includes('probe.js'));
    console.log('goodsId matches:', (pdd.data.match(/goodsId/g) || []).length);
  } catch(e) { console.log('PDD ERR:', e.message); }
})();
