// ---------------------------------------------------------------------------
// AZURE SETUP
// ---------------------------------------------------------------------------
//  Resources to create in the Azure Portal:
//
//  1. Azure Cosmos DB  (API: NoSQL)
//     - Database name :  locationmap
//     - Container name:  locations   (partition key: /sessionId)
//     - Container name:  leases      (partition key: /id)
//       (leases container is auto-used by the Change Feed Trigger)
//     - Copy the Primary Connection String from the Keys blade
//
//  2. Azure SignalR Service
//     - Service mode: Serverless
//     - Copy the connection string from the Keys blade
//
//  3. Azure Static Web Apps
//     - Link to your GitHub / Azure DevOps repo
//     - App location  : /
//     - Api location  : api
//     - Output location: (leave blank)
//     - In Configuration > Application Settings add:
//         COSMOS_DB_CONNECTION         = <cosmos connection string>
//         AzureSignalRConnectionString = <signalr connection string>
//
//  Local dev: fill in api/local.settings.json with the same values.
// ---------------------------------------------------------------------------

// -- Session identity ---------------------------------------------------------
let sessionId = sessionStorage.getItem('locationMapSessionId');
if (!sessionId) {
  sessionId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  sessionStorage.setItem('locationMapSessionId', sessionId);
}

// -- Mode detection -----------------------------------------------------------
// Plain URL = host map view.  ?user URL = participant entry form.
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
  const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=1';
  const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding service unavailable');
  const data = await res.json();
  if (!data.length) throw new Error('Location "' + escapeHtml(query) + '" not found');
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

  const bySession   = {};  // sessionId  -> locationKey
  const rendered    = {};  // locationKey -> { displayName, lat, lon, count, marker }
  const entriesList = document.getElementById('entries');
  const totalBadge  = document.getElementById('total-badge');
  const liveDot     = document.getElementById('live-dot');

  function buildDivIcon(count) {
    return L.divIcon({
      className: '',
      html: '<div class="map-marker"><span>' + count + '</span></div>',
      iconSize:   [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function popupHtml(key) {
    const loc   = rendered[key];
    const count = loc.count;
    return '<strong>' + escapeHtml(loc.displayName) + '</strong><br>' +
           '<span class="popup-count">' + count + ' ' + (count === 1 ? 'person' : 'people') + '</span>';
  }

  function updateSidebar() {
    const total = Object.values(rendered).reduce(function(sum, loc) { return sum + loc.count; }, 0);
    totalBadge.textContent = total + ' ' + (total === 1 ? 'entry' : 'entries');
    entriesList.innerHTML  = '';
    Object.entries(rendered)
      .sort(function(a, b) { return b[1].count - a[1].count; })
      .forEach(function(entry) {
        var key = entry[0]; var loc = entry[1];
        var li = document.createElement('li');
        li.innerHTML =
          '<span class="loc-name">'  + escapeHtml(loc.displayName) + '</span>' +
          '<span class="loc-count">' + loc.count + ' ' + (loc.count === 1 ? 'person' : 'people') + '</span>';
        li.addEventListener('click', function() {
          map.setView([loc.lat, loc.lon], 6, { animate: true });
          loc.marker.openPopup();
        });
        entriesList.appendChild(li);
      });
  }

  function refreshMarker(key) {
    var loc = rendered[key];
    if (loc.marker) loc.marker.remove();
    var marker = L.marker([loc.lat, loc.lon], { icon: buildDivIcon(loc.count) }).addTo(map);
    marker.bindPopup(popupHtml(key));
    loc.marker = marker;
  }

  function applyDocument(doc) {
    var sid      = doc.sessionId || doc.id;
    var key      = doc.locationKey;
    var prevKey  = bySession[sid];
    var isNewSid = !Object.prototype.hasOwnProperty.call(bySession, sid);

    if (prevKey && prevKey !== key) {
      rendered[prevKey].count -= 1;
      if (rendered[prevKey].count <= 0) {
        if (rendered[prevKey].marker) rendered[prevKey].marker.remove();
        delete rendered[prevKey];
      } else {
        refreshMarker(prevKey);
      }
    }

    bySession[sid] = key;
    if (!rendered[key]) {
      rendered[key] = { displayName: doc.displayName, lat: doc.lat, lon: doc.lon, count: 0, marker: null };
    }
    if (!prevKey || prevKey !== key) rendered[key].count += 1;

    rendered[key].displayName = doc.displayName;
    rendered[key].lat = doc.lat;
    rendered[key].lon = doc.lon;

    refreshMarker(key);
    updateSidebar();

    if (isNewSid || prevKey !== key) {
      map.flyTo([doc.lat, doc.lon], 5, { duration: 1.2 });
    }
  }

  function resetMap() {
    Object.values(rendered).forEach(function(loc) { if (loc.marker) loc.marker.remove(); });
    Object.keys(rendered).forEach(function(k) { delete rendered[k]; });
    Object.keys(bySession).forEach(function(k) { delete bySession[k]; });
    updateSidebar();
    map.setView([20, 0], 2);
  }

  async function loadInitial() {
    try {
      const res  = await fetch('/api/getLocations');
      const docs = await res.json();
      if (Array.isArray(docs)) docs.forEach(applyDocument);
    } catch (e) {
      console.error('Failed to load initial locations', e);
    }
  }

  async function connectSignalR() {
    liveDot.title = 'Connecting...';
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/api')
      .withAutomaticReconnect()
      .build();

    connection.on('locationUpdate', function(doc) { applyDocument(doc); });
    connection.on('reset', function() { resetMap(); });

    connection.onreconnecting(function() {
      liveDot.classList.remove('connected');
      liveDot.title = 'Reconnecting...';
    });
    connection.onreconnected(function() {
      liveDot.classList.add('connected');
      liveDot.title = 'Live - syncing in real time';
      loadInitial();
    });
    connection.onclose(function() {
      liveDot.classList.remove('connected');
      liveDot.title = 'Disconnected';
    });

    await connection.start();
    liveDot.classList.add('connected');
    liveDot.title = 'Live - syncing in real time';
  }

  loadInitial().then(function() { return connectSignalR(); });

  document.getElementById('reset-btn').addEventListener('click', function() {
    if (confirm('This will clear ALL pins for everyone. Continue?')) {
      fetch('/api/resetLocations', { method: 'DELETE' });
    }
  });

  document.getElementById('copy-link-btn').addEventListener('click', function() {
    var userLink = window.location.origin + window.location.pathname + '?user';
    navigator.clipboard.writeText(userLink).then(function() {
      var btn = document.getElementById('copy-link-btn');
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy User Link'; }, 2000);
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

  function setStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className   = 'status-' + (type || 'info');
  }

  async function submitLocation() {
    var rawLoc = locInput.value.trim();
    if (!rawLoc) {
      setStatus('Please enter a location.', 'error');
      locInput.focus();
      return;
    }

    addBtn.disabled = true;
    setStatus('Searching...', 'info');

    try {
      const result = await geocode(rawLoc);
      const res = await fetch('/api/addLocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId:   sessionId,
          displayName: result.displayName,
          lat:         result.lat,
          lon:         result.lon,
          locationKey: result.locationKey,
        }),
      });
      if (!res.ok) throw new Error('Failed to save location');
      setStatus('Pinned: ' + result.displayName, 'success');
      locInput.value     = '';
      addBtn.textContent = 'Update My Location';
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      addBtn.disabled = false;
    }
  }

  addBtn.addEventListener('click', submitLocation);
  locInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitLocation(); });
}
