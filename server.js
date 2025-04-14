const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
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
    } else if (res.headers.get('content-type') === 'application/json') {
      const data = await res.json();
      if (data.errors && data.errors.some(err => err.message === 'Challenge is required to authorize the request')) {
        console.log('Solving captcha...');
        const browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setCookie({
          name: '.ROBLOSECURITY',
          value: cookie,
          domain: '.roblox.com',
          httpOnly: true,
          secure: true,
          path: '/'
        });
        await page.goto(url, { waitUntil: 'domcontentloaded' }); 
        await solveCaptcha(page);
        res = await fetch(url, {
          method: 'POST',
          headers: baseHeaders,
          body,
          redirect: 'manual'
        });
        await browser.close();
      }
    }
  }
  return res;
}

async function solveCaptcha(page) {
  const apiKey = '097c8a4c30aa77f731649614c55cdbb5'; // Replace with your actual API key from freecaptchabypass
  try {
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
    const iframeHandle = await page.$('iframe[src*="recaptcha"]');
    const iframe = await iframeHandle.contentFrame();
    const sitekey = await iframe.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));
    const pageurl = page.url();
    const inRes = await axios.post('https://freecaptchabypass.com/api/recaptcha', {
      key: apiKey,
      method: 'userrecaptcha',
      googlekey: sitekey,
      pageurl: pageurl
    });
    if (inRes.data.status !== 'success') throw new Error('Captcha submit failed: ' + inRes.data.message);
    const requestId = inRes.data.request_id;
    let solution;
    while (true) {
      const outRes = await axios.get('https://freecaptchabypass.com/api/recaptcha/result', {
        params: { key: apiKey, id: requestId }
      });
      if (outRes.data.status === 'pending') {
        await new Promise(r => setTimeout(r, 5000));
      } else if (outRes.data.status === 'success') {
        solution = outRes.data.token;
        break;
      } else {
        throw new Error('Captcha solving failed: ' + outRes.data.message);
      }
    }
    await page.evaluate(token => {
      document.getElementById('g-recaptcha-response').innerHTML = token;
    }, solution);
    await page.click('button[type="submit"]');
  } catch (err) {
    console.error('Captcha solve error:', err.message);
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
    console.warn('API failed, falling back to Puppeteer');
  } catch (e) {
    console.error('API post error:', e);
  }
  try {
    const browser = await puppeteer.launch({
      headless: true, // Must be headless for Render
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Needed for serverless environments
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);
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
    console.log('Waiting for wall input...');
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 30000 });
    await page.click('div[contenteditable="true"]');
    await page.keyboard.type(message);
    console.log('Checking for Post button...');
    const [postBtn] = await page.$x("//button[contains(normalize-space(.), 'Post')]");
    if (!postBtn) throw new Error('Post button not found');
    await postBtn.click();
    await page.waitForTimeout(3000);
    await browser.close();
    console.log('Post submitted via Puppeteer');
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
  
