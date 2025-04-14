const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Get authenticated user info
app.get('/user', async (req, res) => {
  const COOKIE = req.headers.authorization;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: `.ROBLOSECURITY=${COOKIE}`,
      },
    });

    if (!response.ok) throw new Error('Invalid cookie');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// Get user groups
app.get('/groups/:userId', async (req, res) => {
  const COOKIE = req.headers.authorization;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const response = await fetch(`https://groups.roblox.com/v2/users/${req.params.userId}/groups/roles`, {
      headers: {
        Cookie: `.ROBLOSECURITY=${COOKIE}`,
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post message to group wall using Puppeteer-core
app.post('/post', async (req, res) => {
  const COOKIE = req.headers.authorization;
  const { groupId, message } = req.body;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser', // adjust path for your host
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: COOKIE,
      domain: '.roblox.com',
    });

    await page.goto(`https://www.roblox.com/groups/${groupId}`, {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForSelector('textarea[name="message"]');
    await page.type('textarea[name="message"]', message);

    console.log('If CAPTCHA appears, solve it manually in the headful browser.');

    await page.waitForSelector('button[type="submit"]');
    await page.click('button[type="submit"]');

    // Optional: wait for some success confirmation element
    await page.waitForTimeout(3000); // adjust if needed

    await browser.close();
    res.json({ success: true });
  } catch (err) {
    console.error('Error during post:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
