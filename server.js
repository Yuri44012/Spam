const express   = require('express');
const fetch     = require('node-fetch');
const cors      = require('cors');
const path      = require('path');
const puppeteer = require('puppeteer');
const axios     = require('axios');  // for 2Captcha

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper to get .ROBLOSECURITY from header or body
const getUserCookie = req =>
  req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
  req.body.cookie ||
  null;

// Direct‑API post helper
async function postViaApi(cookie, groupId, message) {
  return fetch(
    `https://groups.roblox.com/v1/groups/${groupId}/wall/posts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({ body: message }),
      redirect: 'manual'
    }
  );
}

// CAPTCHA solver (unchanged)
async function solveCaptcha(page) {
  const apiKey = 'a510508163576728d096497dd065e4e5';
  try {
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
    const iframeHandle = await page.$('iframe[src*="recaptcha"]');
    const iframe = await iframeHandle.contentFrame();
    const sitekey = await iframe.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));

    const inRes = await axios.post('http://2captcha.com/in.php', null, {
      params: { key: apiKey, method: 'userrecaptcha', googlekey: sitekey, pageurl: page.url() }
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

// --- ROUTES ---

// Get authenticated user
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

// Get group roles
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

// Post to group wall
app.post('/post', async (req, res) => {
  const cookie  = getUserCookie(req);
  const { groupId, message } = req.body;
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  // --- 1) Try direct API first ---
  /*
  try {
    const apiRes = await postViaApi(cookie, groupId, message);
    if (apiRes.ok) {
      return res.json({ success: true, via: 'api' });
    }
    console.log('API post failed, status:', apiRes.status);
  } catch (e) {
    console.log('API post error, falling back to Puppeteer:', e.message);
  }
  */

  // --- 2) Puppeteer fallback ---
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // a) Disable all timeouts
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    // b) Block images/styles/fonts to speed up load
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (['image','stylesheet','font','media'].includes(t)) req.abort();
      else req.continue();
    });

    // c) Authenticate via cookie
    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: cookie,
      domain: '.roblox.com',
      httpOnly: true,
      secure: true,
      path: '/'
    });

    // d) Go to the wall page, wait only for DOMContentLoaded
    await page.goto(`https://www.roblox.com/groups/${groupId}/wall`, {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('textarea[name="message"]', { timeout: 30000 });
    await page.type('textarea[name="message"]', message);

    // e) Solve CAPTCHA if present
    try { await solveCaptcha(page); } catch {}

    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await browser.close();

    return res.json({ success: true, via: 'puppeteer' });
  } catch (err) {
    console.error('Post error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Serve your frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
