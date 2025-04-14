const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');  // To communicate with 2Captcha API

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper to get cookie from header or body
const getUserCookie = (req) =>
  req.headers.authorization || req.body.cookie || null;

// Function to solve CAPTCHA using 2Captcha
async function solveCaptcha(page) {
  const apiKey = 'a510508163576728d096497dd065e4e5';  // Your 2Captcha API key

  // Wait for the CAPTCHA iframe to appear
  await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
  const iframeHandle = await page.$('iframe[src*="recaptcha"]');
  const iframe = await iframeHandle.contentFrame();

  // Extract the CAPTCHA sitekey
  const sitekey = await iframe.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));

  // Send the CAPTCHA challenge to 2Captcha
  const response = await axios.post('http://2captcha.com/in.php', null, {
    params: {
      key: apiKey,
      method: 'userrecaptcha',
      googlekey: sitekey,
      pageurl: page.url(),
    }
  });

  const requestId = response.data.request;
  let solution;
  
  // Wait for the CAPTCHA solution to be ready
  while (true) {
    const result = await axios.get('http://2captcha.com/res.php', {
      params: {
        key: apiKey,
        action: 'get',
        id: requestId,
      }
    });

    if (result.data === 'CAPCHA_NOT_READY') {
      console.log('CAPTCHA is not ready, retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000));  // Retry after 5 seconds
    } else {
      solution = result.data.split('|')[1];
      break;
    }
  }

  // Solve the CAPTCHA by filling the token into the iframe
  await iframe.evaluate((token) => {
    document.getElementById('g-recaptcha-response').innerHTML = token;
  }, solution);

  // Click the submit button after CAPTCHA is solved
  await page.click('button[type="submit"]');
}

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
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: null,
      timeout: 60000,
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

    console.log('Navigating to the group wall...');
    await page.goto(`https://www.roblox.com/groups/${groupId}/wall`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('Waiting for message input field...');
    await page.waitForSelector('textarea[name="message"]', { timeout: 30000 });
    await page.type('textarea[name="message"]', message);

    // Solve CAPTCHA if present
    try {
      await solveCaptcha(page);
    } catch (error) {
      console.error('Captcha handling failed:', error.message);
    }

    console.log('Waiting for submit button...');
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await page.click('button[type="submit"]');

    // Wait for 3 seconds to ensure post is completed
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
