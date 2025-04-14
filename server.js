const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper to get cookie from header or body
const getUserCookie = (req) =>
  req.headers.authorization || req.body.cookie || null;

// Get authenticated user info
app.get('/user', async (req, res) => {
  const cookie = getUserCookie(req);
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  try {
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });

    if (!response.ok) throw new Error('Invalid cookie');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// Get user's group roles
app.get('/groups/:userId', async (req, res) => {
  const cookie = getUserCookie(req);
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  try {
    const response = await fetch(`https://groups.roblox.com/v2/users/${req.params.userId}/groups/roles`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post message using Puppeteer
app.post('/post', async (req, res) => {
  const cookie = getUserCookie(req);
  const { groupId, message } = req.body;
  if (!cookie) return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });

  try {
    const browser = await puppeteer.launch({
      headless: true,  // Ensure headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox'],  // Disable sandboxing (needed for some environments like Render)
      defaultViewport: null,
      timeout: 60000, // Increase the launch timeout
    });

    const page = await browser.newPage();

    // Set the cookie for authentication
    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: cookie,
      domain: '.roblox.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    // Go to the group page and wait for the page to load
    console.log('Navigating to the group page...');
    await page.goto(`https://www.roblox.com/groups/${groupId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,  // Increased navigation timeout
    });

    // Wait for the message input field to appear
    console.log('Waiting for the message input field...');
    await page.waitForSelector('textarea[name="message"]', { timeout: 10000 });

    // Type the message into the textarea
    await page.type('textarea[name="message"]', message);

    // Wait for the submit button and click it
    console.log('Waiting for submit button...');
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await page.click('button[type="submit"]');

    // Wait for 3 seconds to ensure the post is completed
    await page.waitForTimeout(3000);
    await browser.close();

    res.json({ success: true });
  } catch (err) {
    console.error('Post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
