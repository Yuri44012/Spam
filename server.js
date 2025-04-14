const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

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

// Post message to group wall (with CSRF token)
app.post('/post', async (req, res) => {
  const COOKIE = req.headers.authorization;
  const { groupId, message } = req.body;
  if (!COOKIE) return res.status(400).json({ error: 'Missing cookie' });

  try {
    // Get CSRF token
    const tokenRes = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: {
        Cookie: `.ROBLOSECURITY=${COOKIE}`
      }
    });

    const csrfToken = tokenRes.headers.get('x-csrf-token');
    if (!csrfToken) throw new Error('Failed to get X-CSRF-TOKEN');

    // Send wall post
    const postRes = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/wall/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        Cookie: `.ROBLOSECURITY=${COOKIE}`
      },
      body: JSON.stringify({ body: message })
    });

    if (!postRes.ok) {
      const errorText = await postRes.text();
      console.error("Post failed:", errorText);
      throw new Error('Failed to post');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
