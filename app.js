// =============================================================================
// Firebase configuration
// =============================================================================
// Config is stored in localStorage so the host can enter it via the Settings
// panel without touching code. Fallback values are just placeholders.
const STORAGE_KEY = "mapplot_firebase_config";

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function isConfigured() {
  const c = loadConfig();
  return c.apiKey && c.projectId && !c.apiKey.startsWith("YOUR_");
}

function withTimeout(promise, ms, msg) {
  const t = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(msg)), ms)
  );
  return Promise.race([promise, t]);
}

const savedConfig = loadConfig();

const firebaseConfig = {
  apiKey:            savedConfig.apiKey            || "YOUR_API_KEY",
  authDomain:        savedConfig.authDomain        || "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       savedConfig.databaseURL       || undefined,
  projectId:         savedConfig.projectId         || "YOUR_PROJECT_ID",
  storageBucket:     savedConfig.storageBucket     || "YOUR_PROJECT.appspot.com",
  messagingSenderId: savedConfig.messagingSenderId || "YOUR_SENDER_ID",
  appId:             savedConfig.appId             || "YOUR_APP_ID",
  measurementId:     savedConfig.measurementId     || undefined,
};

firebase.initializeApp(firebaseConfig);
const db           = firebase.firestore();
const locationsRef = db.collection("locations");

// =============================================================================
// Settings modal
// =============================================================================
(function initSettings() {
  const overlay  = document.getElementById("settings-overlay");
  const fields   = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "databaseURL", "measurementId"];

  function openModal() {
    const cfg = loadConfig();
    fields.forEach(k => {
      const el = document.getElementById("cfg-" + k);
      if (el) el.value = cfg[k] || "";
    });
    overlay.classList.add("open");
  }

  function closeModal() {
    overlay.classList.remove("open");
  }

  document.getElementById("settings-btn")   .addEventListener("click", openModal);
  document.getElementById("settings-close") .addEventListener("click", closeModal);
  document.getElementById("settings-cancel").addEventListener("click", closeModal);

  // Stop ALL events inside the modal from reaching the backdrop
  document.getElementById("settings-modal").addEventListener("click",   e => e.stopPropagation());
  document.getElementById("settings-modal").addEventListener("mousedown", e => e.stopPropagation());

  // Escape key closes the modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  // Prevent Enter inside inputs from triggering anything unexpected
  document.querySelectorAll("#settings-modal input").forEach(input => {
    input.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
  });

  document.getElementById("settings-save").addEventListener("click", () => {
    const cfg = {};
    fields.forEach(k => {
      cfg[k] = (document.getElementById("cfg-" + k).value || "").trim();
    });
    saveConfig(cfg);
    closeModal();
    window.location.reload();
  });
})();

// -- Session identity ---------------------------------------------------------
let sessionId = sessionStorage.getItem("locationMapSessionId");
if (!sessionId) {
  sessionId = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  sessionStorage.setItem("locationMapSessionId", sessionId);
}

// -- Mode detection -----------------------------------------------------------
const isHost = !new URLSearchParams(window.location.search).has("user");

document.getElementById("app").style.display       = isHost ? "flex" : "none";
document.getElementById("user-view").style.display = isHost ? "none" : "flex";

// Warn user-view visitors immediately if Firebase isn't set up
if (!isHost && !isConfigured()) {
  const statusMsg = document.getElementById("status-message");
  if (statusMsg) {
    statusMsg.textContent = "This app is not yet configured. Contact the host.";
    statusMsg.className   = "status-error";
  }
  const addBtn = document.getElementById("add-btn");
  if (addBtn) addBtn.disabled = true;
}

// -- Shared helpers -----------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res  = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Geocoding service unavailable");
  const data = await res.json();
  if (!data.length) throw new Error(`Location "${escapeHtml(query)}" not found`);
  const shortName = data[0].display_name.split(",").slice(0, 2).join(",").trim();
  return {
    displayName: shortName,
    lat:         parseFloat(data[0].lat),
    lon:         parseFloat(data[0].lon),
    locationKey: String(data[0].place_id),
  };
}

// =============================================================================
// HOST MODE � full map view
// =============================================================================
if (isHost) {
  const map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  const rendered    = {};
  let   knownKeys   = new Set();
  const entriesList = document.getElementById("entries");
  const totalBadge  = document.getElementById("total-badge");
  const liveDot     = document.getElementById("live-dot");

  function buildDivIcon(count) {
    return L.divIcon({
      className: "",
      html: `<div class="map-marker"><span>${count}</span></div>`,
      iconSize:   [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function popupHtml(key) {
    const loc   = rendered[key];
    const count = loc.count;
    return `<strong>${escapeHtml(loc.displayName)}</strong><br>
            <span class="popup-count">${count} ${count === 1 ? "person" : "people"}</span>`;
  }

  // rows = array of Firestore doc data: { session_id, display_name, lat, lon, location_key }
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
    totalBadge.textContent = `${totalUsers} ${totalUsers === 1 ? "entry" : "entries"}`;
    entriesList.innerHTML  = "";

    const newKeys = Object.keys(rendered).filter(k => !knownKeys.has(k));
    if (newKeys.length > 0) {
      const newest = rendered[newKeys[0]];
      map.flyTo([newest.lat, newest.lon], 5, { duration: 1.2 });
    }
    knownKeys = new Set(Object.keys(rendered));

    Object.entries(rendered)
      .sort((a, b) => b[1].count - a[1].count)
      .forEach(([key, loc]) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span class="loc-name">${escapeHtml(loc.displayName)}</span>
          <span class="loc-count">${loc.count} ${loc.count === 1 ? "person" : "people"}</span>`;
        li.addEventListener("click", () => {
          map.setView([loc.lat, loc.lon], 6, { animate: true });
          loc.marker.openPopup();
        });
        entriesList.appendChild(li);
      });
  }

  // Real-time listener � Firestore onSnapshot replaces SSE
  liveDot.classList.add("connecting");
  liveDot.title = "Connecting to Firebase…";

  locationsRef.onSnapshot(
    snapshot => {
      liveDot.classList.remove("connecting");
      liveDot.classList.add("connected");
      liveDot.title = "Live — syncing in real time";
      render(snapshot.docs.map(doc => doc.data()));
    },
    err => {
      liveDot.classList.remove("connecting", "connected");
      liveDot.title = "Connection error � check Firebase config";
      console.error("Firestore onSnapshot error:", err);
    }
  );

  document.getElementById("reset-btn").addEventListener("click", async () => {
    if (confirm("This will clear ALL pins for everyone. Continue?")) {
      const snapshot = await locationsRef.get();
      const batch    = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      map.setView([20, 0], 2);
    }
  });

  document.getElementById("copy-link-btn").addEventListener("click", () => {
    const userLink = window.location.origin + window.location.pathname + "?user";
    const btn = document.getElementById("copy-link-btn");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(userLink).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy User Link"; }, 2000);
      }).catch(() => {
        prompt("Copy this link and share it:", userLink);
      });
    } else {
      prompt("Copy this link and share it:", userLink);
    }
  });
}

// =============================================================================
// USER MODE � location entry form only
// =============================================================================
if (!isHost) {
  const locInput  = document.getElementById("location-input");
  const addBtn    = document.getElementById("add-btn");
  const statusMsg = document.getElementById("status-message");

  function setStatus(msg, type = "info") {
    statusMsg.textContent = msg;
    statusMsg.className   = `status-${type}`;
  }

  async function submitLocation() {
    const rawLoc = locInput.value.trim();
    if (!rawLoc) {
      setStatus("Please enter a location.", "error");
      locInput.focus();
      return;
    }

    addBtn.disabled = true;
    setStatus("Searching\u2026", "info");

    try {
      const result = await geocode(rawLoc);

      if (!isConfigured()) {
        throw new Error("Firebase is not configured. Open ⚙ Settings and enter your Firebase project details.");
      }

      // Race the Firestore write against a timeout.
      // If Firebase rejects (bad creds, rules, etc.) that error wins immediately.
      // The timeout only fires if Firebase goes completely silent (network block, etc.)
      let firebaseError = null;
      const writePromise = locationsRef.doc(sessionId).set({
        session_id:   sessionId,
        display_name: result.displayName,
        lat:          result.lat,
        lon:          result.lon,
        location_key: result.locationKey,
        updated_at:   firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(err => { firebaseError = err; throw err; });

      await withTimeout(
        writePromise,
        10000,
        firebaseError
          ? firebaseError.message
          : "Could not reach Firebase — check your Settings and Firestore rules."
      );

      setStatus(`Pinned: ${result.displayName}`, "success");
      locInput.value     = "";
      addBtn.textContent = "Update My Location";
    } catch (err) {
      setStatus(err.message || "Failed to save location", "error");
    } finally {
      addBtn.disabled = false;
    }
  }

  addBtn.addEventListener("click", submitLocation);
  locInput.addEventListener("keydown", e => { if (e.key === "Enter") submitLocation(); });
}
