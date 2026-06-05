const express  = require('express');
const fs       = require('fs');
const path     = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DB_FILE  = path.join(__dirname, 'locations.json');

// ---------------------------------------------------------------------------
// JSON flat-file store — created automatically on first run
// ---------------------------------------------------------------------------
// Shape: { [sessionId]: { display_name, lat, lon, location_key, updated_at } }

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data), 'utf8');
}

function dbToRows(data) {
  return Object.entries(data).map(([session_id, v]) => ({ session_id, ...v }));
}

// ---------------------------------------------------------------------------
// SSE — keep a set of active host connections and push to all of them
// ---------------------------------------------------------------------------
const clients = new Set();

function broadcast() {
  const rows = dbToRows(readDb());
  const payload = JSON.stringify(rows);
  for (const res of clients) {
    res.write(`data: ${payload}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serves index.html, app.js, styles.css

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

// Initial load
app.get('/locations', (_req, res) => {
  res.json(dbToRows(readDb()));
});

// Real-time stream for the host view
app.get('/locations/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send current state immediately so the map isn't blank on load
  res.write(`data: ${JSON.stringify(dbToRows(readDb()))}\n\n`);

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Add or update a pin
app.post('/locations', (req, res) => {
  const { sessionId, displayName, lat, lon, locationKey } = req.body;

  if (!sessionId || !displayName || lat == null || lon == null || !locationKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (typeof lat !== 'number' || typeof lon !== 'number' ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const data = readDb();
  data[sessionId] = { display_name: displayName, lat, lon, location_key: locationKey, updated_at: Date.now() };
  writeDb(data);
  broadcast();
  res.json({ ok: true });
});

// Reset — clear all pins
app.delete('/locations', (_req, res) => {
  writeDb({});
  broadcast();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Map server →  http://localhost:${PORT}`);
  console.log(`Host view  →  http://localhost:${PORT}/          (keep this private)`);
  console.log(`User link  →  http://localhost:${PORT}/?user     (share this)`);
});
