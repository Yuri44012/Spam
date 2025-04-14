app.post('/post', async (req, res) => {
  console.log('POST /post called with:', req.body);

  const cookie  = getUserCookie(req);
  const { groupId, message } = req.body;
  if (!cookie) {
    console.warn('Missing cookie in request');
    return res.status(400).json({ error: 'Missing .ROBLOSECURITY cookie' });
  }

  try {
    const apiRes  = await postViaApi(cookie, groupId, message);
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
      executablePath: '/usr/bin/chromium-browser', // Required for Render
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

    console.log('Puppeteer: page loaded, locating iframe');
    await page.waitForSelector('#group-wall-iframe', { timeout: 30000 });

    const iframeHandle = await page.$('#group-wall-iframe');
    const frame = await iframeHandle.contentFrame();

    console.log('Puppeteer: waiting for wall message input in iframe');
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
    if (postBtn) {
      await postBtn.click();
    } else {
      console.warn('Post button not found inside iframe');
    }

    await page.waitForTimeout(3000);
    await browser.close();

    console.log('Puppeteer: post complete');
    return res.json({ success: true, via: 'puppeteer' });

  } catch (err) {
    console.error('Puppeteer post error:', err);
    return res.status(500).json({ error: err.message });
  }
});
