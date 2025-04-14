const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const COOKIE = process.env.ROBLOSECURITY;

if (!COOKIE) {
  console.error("Missing .ROBLOSECURITY in .env");
  process.exit(1);
}

app.get('/user', async (req, res) => {
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

app.get('/groups/:userId', async (req, res) => {
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

app.post('/post', async (req, res) => {
  const { groupId, message } = req.body;
  try {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/wall/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `.ROBLOSECURITY=${COOKIE}`
      },
      body: JSON.stringify({ body: message })
    });
    if (!response.ok) throw new Error('Failed to post');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
