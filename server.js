const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');  // Import Puppeteer

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
        Cookie: `.ROBLOSECURITY=${COOKIE}`
      }
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
        Cookie: `.ROBLOSECURITY=${COOKIE}`
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post message to group wall using Puppeteer to bypass CAPTCHA
app.post('/post', async (req, res) => {
  const COOKIE = req.headers.authorization;
  const { groupId, message } = req.body;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    // Launch Puppeteer
    const browser = await puppeteer.launch({ headless: false });  // Set to false to interact with the browser
    const page = await browser.newPage();

    // Set the cookie for the current session
    await page.setCookie({
      name: '.ROBLOSECURITY',
      value: COOKIE,
      domain: '.roblox.com',
    });

    // Navigate to Roblox Group Wall
    await page.goto(`https://www.roblox.com/groups/${groupId}`);

    // Wait for the page to load and the post form to be available
    await page.waitForSelector('textarea[name="message"]'); // Adjust selector as per your page structure

    // Type the message
    await page.type('textarea[name="message"]', message);

    // Solve CAPTCHA manually (first time)
    console.log('Please solve the CAPTCHA manually in the browser window.');

    // Wait for the form to be able to submit (after CAPTCHA)
    await page.waitForSelector('button[type="submit"]'); // Adjust selector

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for the confirmation that the message was posted
    await page.waitForSelector('.success-message'); // Adjust this selector based on the page structure

    console.log('Post successful!');

    // Close the browser after success
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
