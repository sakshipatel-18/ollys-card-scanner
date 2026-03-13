const express  = require('express');
const cors     = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app  = express();
const port = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Serve Static Files from public folder ─────────────────────────────────
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: "Olly's Card Scanner API" });
});

// ── GET /api/counts ────────────────────────────────────────────────────────
// Fetches lead counts (total, hot, medium, cold) from Google Apps Script
app.get('/api/counts', async (req, res) => {
  try {
    const GAS_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!GAS_URL) {
      return res.status(500).json({ error: 'Google Apps Script URL not configured on server.' });
    }

    // Call GAS doGet with action=counts
    const gasRes = await fetch(`${GAS_URL}?action=counts`, { redirect: 'follow' });
    const text   = await gasRes.text();

    let gasJson;
    try { gasJson = JSON.parse(text); } catch { gasJson = null; }

    if (!gasJson) {
      return res.status(502).json({ error: 'Invalid response from Google Sheets', detail: text });
    }

    // Normalise: GAS may return { total, hot, medium, cold } or { total, hot, warm, cold }
    return res.json({
      total:  gasJson.total  || 0,
      hot:    gasJson.hot    || 0,
      medium: gasJson.medium || gasJson.warm || 0,
      cold:   gasJson.cold   || 0,
    });
  } catch (err) {
    console.error('Counts error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/scan ─────────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format. Must be a base64 data URL.' });
    }

    const mediaType = match[1];
    const base64    = match[2];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `You are a business card OCR assistant. 
Extract the following fields from this business card image and return ONLY valid JSON (no markdown, no explanation):

{
  "name":       "contact person's full name",
  "brandName":  "company or brand name",
  "storeCount": "number of stores or branches if mentioned, else empty string",
  "city":       "city name",
  "phone":      "phone number digits only (no spaces or dashes)",
  "email":      "email address if present, else empty string",
  "category":   "one of: Retail | Restaurant / Food | Healthcare | Finance / Banking | Technology | Automotive | Real Estate | Education | Fashion / Apparel | Grocery / Supermarket | Other"
}

If a field is not clearly visible, use an empty string. Return ONLY the JSON object.`,
            },
          ],
        },
      ],
    });

    const raw     = response.content[0]?.text || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Claude returned non-JSON:', raw);
      return res.status(422).json({ error: 'Could not parse card — please try manual entry.' });
    }

    if (parsed.phone) {
      parsed.phone = parsed.phone.replace(/\D/g, '');
    }

    return res.json(parsed);
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/submit ───────────────────────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const GAS_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!GAS_URL) {
      return res.status(500).json({ error: 'Google Apps Script URL not configured on server.' });
    }

    const payload = req.body;

    const gasRes = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    const text = await gasRes.text();

    let gasJson;
    try { gasJson = JSON.parse(text); } catch { gasJson = { message: text }; }

    if (!gasRes.ok && gasRes.status !== 302) {
      return res.status(502).json({ error: 'Google Sheets write failed', detail: text });
    }

    return res.json({ success: true, gas: gasJson });
  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`✅  Olly's Card Scanner API running on port ${port}`);
});