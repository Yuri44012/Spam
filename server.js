const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

app.get('/user', async (req, res) => {
  const COOKIE = req.headers.authorization;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${COOKIE}` },
    });

    if (!response.ok) throw new Error('Invalid cookie');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get('/groups/:userId', async (req, res) => {
  const COOKIE = req.headers.authorization;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch(`https://groups.roblox.com/v2/users/${req.params.userId}/groups/roles`, {
      headers: { Cookie: `.ROBLOSECURITY=${COOKIE}` },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/post', async (req, res) => {
  const COOKIE = req.headers.authorization;
  const { groupId, message } = req.body;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const browser = await puppeteer.launch({
      executablePath: await chromium.executablePath || '/usr/bin/chromium-browser',
      args: chromium.args,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: COOKIE,
      domain: '.roblox.com',
    });

    await page.goto(`https://www.roblox.com/groups/${groupId}`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('textarea[name="message"]');
    await page.type('textarea[name="message"]', message);

    await page.waitForSelector('button[type="submit"]');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(3000);
    await browser.close();

    res.json({ success: true });
  } catch (err) {
    console.error('Post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
