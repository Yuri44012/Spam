const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const COOKIE = process.env.ROBLOSECURITY;

// Check for missing .ROBLOSECURITY cookie
if (!COOKIE) {
  console.error("Missing .ROBLOSECURITY in .env");
  process.exit(1);
}

// Route to get authenticated user info
app.get('/user', async (req, res) => {
  const userCookie = req.headers.authorization || COOKIE;
  if (!userCookie) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${userCookie}` },
    });

    if (!response.ok) throw new Error('Invalid cookie');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// Route to get user's group roles
app.get('/groups/:userId', async (req, res) => {
  const userCookie = req.headers.authorization || COOKIE;
  if (!userCookie) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch(`https://groups.roblox.com/v2/users/${req.params.userId}/groups/roles`, {
      headers: { Cookie: `.ROBLOSECURITY=${userCookie}` },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to post a message to a group wall using Puppeteer
app.post('/post', async (req, res) => {
  const userCookie = req.headers.authorization || COOKIE;
  const { groupId, message } = req.body;
  if (!userCookie) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const browser = await puppeteer.launch({
      executablePath: await chromium.executablePath, // Correct path from chrome-aws-lambda
      args: chromium.args,
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    });

    const page = await browser.newPage();

    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: userCookie,
      domain: '.roblox.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    await page.goto(`https://www.roblox.com/groups/${groupId}`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('textarea[name="message"]', { timeout: 10000 });
    await page.type('textarea[name="message"]', message);

    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await page.click('button[type="submit"]');

    await page.waitForTimeout(3000);
    await browser.close();

    res.json({ success: true });
  } catch (err) {
    console.error('Post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
