const express  = require('express');
const cors     = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app  = express();
const port = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',  // Restrict in production to your frontend URL
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '10mb' }));  // Allow large base64 images

// ── Serve Static Files from public folder ─────────────────────────────────
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: "Olly's Card Scanner API" });
});

// ── POST /api/scan ─────────────────────────────────────────────────────────
// Accepts: { image: "data:image/jpeg;base64,..." }
// Returns: extracted card fields as JSON
app.post('/api/scan', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Parse base64 data URL  →  { mediaType, data }
    const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format. Must be a base64 data URL.' });
    }

    const mediaType = match[1];  // e.g. "image/jpeg"
    const base64    = match[2];

    // Call Claude Vision ───────────────────────────────────────────────────
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
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

    // Parse Claude's response ─────────────────────────────────────────────
    const raw = response.content[0]?.text || '{}';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Claude returned non-JSON:', raw);
      return res.status(422).json({ error: 'Could not parse card — please try manual entry.' });
    }

    // Sanitise phone to digits only
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
// Accepts: card fields + submittedBy + submitterEmail + timestamp
// Forwards to Google Apps Script
app.post('/api/submit', async (req, res) => {
  try {
    const GAS_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!GAS_URL) {
      return res.status(500).json({ error: 'Google Apps Script URL not configured on server.' });
    }

    const payload = req.body;

    // Forward to Google Apps Script (doPost)
    const gasRes = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',   // GAS redirects after POST
    });

    const text = await gasRes.text();

    // GAS usually returns plain text or JSON
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