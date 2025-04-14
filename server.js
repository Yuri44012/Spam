const express   = require('express');
const fetch     = require('node-fetch');
const cors      = require('cors');
const path      = require('path');
const puppeteer = require('puppeteer');
const axios     = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const getUserCookie = req =>
  req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body.cookie || null;

async function postViaApi(cookie, groupId, message) {
  const url = `https://groups.roblox.com/v1/groups/${groupId}/wall/posts`;
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `.ROBLOSECURITY=${cookie}`,
    'User-Agent': 'Mozilla/5.0'
  };
  const body = JSON.stringify({ body: message });

  let res = await fetch(url, {
    method: 'POST',
    headers: baseHeaders,
    body,
    redirect: 'manual'
  });

  if (res.status === 403) {
    const token = res.headers.get('x-csrf-token');
    if (token) {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...baseHeaders, 'X-CSRF-TOKEN': token },
        body,
        redirect: 'manual'
      });
    }
  }

  return res;
}

async function solveCaptcha(page) {
  const apiKey = 'a510508163576728d096497dd065e4e5';
  try {
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
    const iframeHandle = await page.$('iframe[src*="recaptcha"]');
    const iframe = await iframeHandle.contentFrame();
    const sitekey = await iframe.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));

    const inRes = await axios.post('http://2captcha.com/in.php', null, {
      params: {
        key: apiKey,
        method: 'userrecaptcha',
        googlekey: sitekey,
        pageurl: page.url()
      }
    });

    const requestId = inRes.data.request;

    let solution;
    while (true) {
      const outRes = await axios.get('http://2captcha.com/res.php', {
        params: { key: apiKey, action: 'get', id: requestId }
      });

      if (outRes.data === 'CAPCHA_NOT_READY') {
        await new Promise(r => setTimeout(r, 5000));
      } else {
        solution = outRes.data.split('|')[1];
        break;
      }
    }

    await iframe.evaluate(token => {
      document.getElementById('g-recaptcha-response').innerHTML = token;
    }, solution);

    await page.click('button[type="submit"]');

  } catch (err) {
    console.error('Captcha solve error:', err);
    throw err;
  }
}

app.get('/user', async (req, res) => {
  const cookie = getUserCookie(req);
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  try {
    const r = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!r.ok) throw new Error('Invalid cookie');
    res.json(await r.json());
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get('/groups/:userId', async (req, res) => {
  const cookie = getUserCookie(req);
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  try {
    const r = await fetch(
      `https://groups.roblox.com/v2/users/${req.params.userId}/groups/roles`,
      { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } }
    );
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/post', async (req, res) => {
  console.log('POST /post called with:', req.body);

  const cookie = getUserCookie(req);
  const { groupId, message } = req.body;

  if (!cookie) {
    console.warn('Missing cookie in request');
    return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });
  }

  try {
    const apiRes = await postViaApi(cookie, groupId, message);
    const apiText = await apiRes.text();
    console.log('API response status:', apiRes.status);
    console.log('API response body:', apiText);

    if (apiRes.ok) {
      return res.json({ success: true, via: 'api' });
    }
    console.warn('API post failed, falling back to Puppeteer');
  } catch (e) {
    console.error('API post error:', e);
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(t)) req.abort();
      else req.continue();
    });

    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: cookie,
      domain: '.roblox.com',
      httpOnly: true,
      secure: true,
      path: '/'
    });

    await page.goto(`https://www.roblox.com/groups/${groupId}/wall`, {
      waitUntil: 'domcontentloaded'
    });

    console.log('Puppeteer: waiting for iframe');
    await page.waitForSelector('#group-wall-iframe', { timeout: 30000 });

    const iframeHandle = await page.$('#group-wall-iframe');
    const frame = await iframeHandle.contentFrame();

    console.log('Puppeteer: waiting for wall input in iframe');
    await frame.waitForSelector('#wall-message-input', { timeout: 30000 });

    await frame.focus('#wall-message-input');
    await frame.type('#wall-message-input', message);

    console.log('Puppeteer: checking for CAPTCHA');
    try {
      await solveCaptcha(page);
      console.log('Puppeteer: CAPTCHA solved');
    } catch (captchaErr) {
      console.warn('Puppeteer: no CAPTCHA or solve failed:', captchaErr.message);
    }

    const [postBtn] = await frame.$x("//button[contains(normalize-space(.), 'Post')]");
    if (!postBtn) throw new Error('Post button not found');
    await postBtn.click();

    await page.waitForTimeout(3000);
    await browser.close();

    console.log('Puppeteer: post complete');
    return res.json({ success: true, via: 'puppeteer' });

  } catch (err) {
    console.error('Puppeteer post error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
