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

// (Optional) direct‐API post instead of Puppeteer
async function postViaApi(cookie, groupId, message) {
  const res = await fetch(
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
  return res;
}

// CAPTCHA solver unchanged
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

// Post to group wall (Puppeteer fallback)
app.post('/post', async (req, res) => {
  const cookie  = getUserCookie(req);
  const { groupId, message } = req.body;
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  // Try direct API first:
  /*
  try {
    const apiRes = await postViaApi(cookie, groupId, message);
    if (apiRes.ok) return res.json({ success: true });
    console.log('API post failed, status:', apiRes.status);
  } catch (e) {
    console.log('API post error, falling back to Puppeteer:', e.message);
  }
  */

  // Puppeteer fallback:
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // authenticate
    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: cookie,
      domain: '.roblox.com',
      httpOnly: true,
      secure: true,
      path: '/'
    });

    // go to the real wall UI
    await page.goto(`https://www.roblox.com/groups/${groupId}/wall`, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForSelector('textarea[name="message"]', { timeout: 30000 });
    await page.type('textarea[name="message"]', message);

    // handle CAPTCHA if it appears
    try { await solveCaptcha(page); } catch {}

    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await browser.close();

    res.json({ success: true });
  } catch (err) {
    console.error('Post error:', err);
    res.status(500).json({ error: err.message });
  }
});

// serve React/Vue/whatever SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
