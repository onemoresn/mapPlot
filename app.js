// -- Session identity ---------------------------------------------------------
// Each browser tab gets a stable ID so re-submitting updates the same pin
// rather than creating a duplicate.
let sessionId = sessionStorage.getItem('locationMapSessionId');
if (!sessionId) {
  sessionId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  sessionStorage.setItem('locationMapSessionId', sessionId);
}

// -- Mode detection -----------------------------------------------------------
// Plain URL = host map view. Share the ?user URL with participants.
const isHost = !new URLSearchParams(window.location.search).has('user');

document.getElementById('app').style.display       = isHost ? 'flex' : 'none';
document.getElementById('user-view').style.display = isHost ? 'none' : 'flex';

// -- Shared helpers -----------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding service unavailable');
  const data = await res.json();
  if (!data.length) throw new Error(`Location "${escapeHtml(query)}" not found`);
  const shortName = data[0].display_name.split(',').slice(0, 2).join(',').trim();
  return {
    displayName: shortName,
    lat:         parseFloat(data[0].lat),
    lon:         parseFloat(data[0].lon),
    locationKey: String(data[0].place_id),
  };
}

// =============================================================================
// HOST MODE — full map view
// =============================================================================
if (isHost) {
  const map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  // locationKey → { displayName, lat, lon, count, marker }
  const rendered    = {};
  let   knownKeys   = new Set();   // tracks keys seen in previous render
  const entriesList = document.getElementById('entries');
  const totalBadge  = document.getElementById('total-badge');
  const liveDot     = document.getElementById('live-dot');

  function buildDivIcon(count) {
    return L.divIcon({
      className: '',
      html: `<div class="map-marker"><span>${count}</span></div>`,
      iconSize:   [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function popupHtml(key) {
    const loc   = rendered[key];
    const count = loc.count;
    return `<strong>${escapeHtml(loc.displayName)}</strong><br>
            <span class="popup-count">${count} ${count === 1 ? 'person' : 'people'}</span>`;
  }

  // rows = array of { session_id, display_name, lat, lon, location_key, updated_at }
  function render(rows) {
    Object.values(rendered).forEach(loc => loc.marker && loc.marker.remove());
    Object.keys(rendered).forEach(k => delete rendered[k]);

    rows.forEach(row => {
      const key = row.location_key;
      if (!rendered[key]) {
        rendered[key] = {
          displayName: row.display_name,
          lat:         row.lat,
          lon:         row.lon,
          count:       0,
          marker:      null,
        };
      }
      rendered[key].count += 1;
    });

    Object.entries(rendered).forEach(([key, loc]) => {
      const marker = L.marker([loc.lat, loc.lon], { icon: buildDivIcon(loc.count) }).addTo(map);
      marker.bindPopup(popupHtml(key));
      loc.marker = marker;
    });

    const totalUsers = rows.length;
    totalBadge.textContent = `${totalUsers} ${totalUsers === 1 ? 'entry' : 'entries'}`;
    entriesList.innerHTML  = '';

    // Fly to any location key that wasn't in the previous render
    const newKeys = Object.keys(rendered).filter(k => !knownKeys.has(k));
    if (newKeys.length > 0) {
      const newest = rendered[newKeys[0]];
      map.flyTo([newest.lat, newest.lon], 5, { duration: 1.2 });
    }
    knownKeys = new Set(Object.keys(rendered));

    Object.entries(rendered)
      .sort((a, b) => b[1].count - a[1].count)
      .forEach(([key, loc]) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="loc-name">${escapeHtml(loc.displayName)}</span>
          <span class="loc-count">${loc.count} ${loc.count === 1 ? 'person' : 'people'}</span>`;
        li.addEventListener('click', () => {
          map.setView([loc.lat, loc.lon], 6, { animate: true });
          loc.marker.openPopup();
        });
        entriesList.appendChild(li);
      });
  }

  // SSE — receive live updates from the server
  const evtSource = new EventSource('/locations/stream');
  evtSource.addEventListener('open', () => {
    liveDot.classList.add('connected');
    liveDot.title = 'Live — syncing in real time';
  });
  evtSource.addEventListener('error', () => {
    liveDot.classList.remove('connected');
    liveDot.title = 'Reconnecting…';
  });
  evtSource.addEventListener('message', e => {
    render(JSON.parse(e.data));
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('This will clear ALL pins for everyone. Continue?')) {
      fetch('/locations', { method: 'DELETE' })
        .then(() => map.setView([20, 0], 2));
    }
  });

  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const userLink = window.location.origin + window.location.pathname + '?user';
    navigator.clipboard.writeText(userLink).then(() => {
      const btn = document.getElementById('copy-link-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy User Link'; }, 2000);
    });
  });
}

// =============================================================================
// USER MODE — location entry form only
// =============================================================================
if (!isHost) {
  const locInput  = document.getElementById('location-input');
  const addBtn    = document.getElementById('add-btn');
  const statusMsg = document.getElementById('status-message');

  function setStatus(msg, type = 'info') {
    statusMsg.textContent = msg;
    statusMsg.className   = `status-${type}`;
  }

  async function submitLocation() {
    const rawLoc = locInput.value.trim();
    if (!rawLoc) {
      setStatus('Please enter a location.', 'error');
      locInput.focus();
      return;
    }

    addBtn.disabled = true;
    setStatus('Searching\u2026', 'info');

    try {
      const result = await geocode(rawLoc);
      const res = await fetch('/locations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId,
          displayName: result.displayName,
          lat:         result.lat,
          lon:         result.lon,
          locationKey: result.locationKey,
        }),
      });
      if (!res.ok) throw new Error('Failed to save location');
      setStatus(`Pinned: ${result.displayName}`, 'success');
      locInput.value     = '';
      addBtn.textContent = 'Update My Location';
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      addBtn.disabled = false;
    }
  }

  addBtn.addEventListener('click', submitLocation);
  locInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitLocation(); });
}
