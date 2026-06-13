// =============================================================================
// Firebase configuration
// =============================================================================
// Config is stored in localStorage so the host can enter it via the Settings
// panel without touching code. When the host copies the user link, the config
// is embedded in the URL hash so remote devices receive it automatically.
const STORAGE_KEY = "mapplot_firebase_config";

function loadConfig() {
  // 1. Check URL hash for embedded config (user devices opening a shared link)
  try {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const encoded = params.get("cfg");
    if (encoded) {
      const cfg = JSON.parse(atob(encoded));
      // Save it locally so subsequent refreshes don't need the hash
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      // Clean the hash from the URL without reloading
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return cfg;
    }
  } catch { /* ignore malformed hash */ }

  // 2. Fall back to locally saved config
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function isConfigured() {
  const c = loadConfig();
  return c.apiKey && c.databaseURL && !c.apiKey.startsWith("YOUR_");
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
let db           = null;
let locationsRef = null;
try {
  db           = firebase.database();
  locationsRef = db.ref("locations");
} catch (err) {
  console.warn("Firebase database not initialized:", err.message);
}

const AZURE_STORAGE_KEY = "mapplot_azure_config";

function loadAzureConfig() {
  try { return JSON.parse(localStorage.getItem(AZURE_STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveAzureConfig(cfg) {
  localStorage.setItem(AZURE_STORAGE_KEY, JSON.stringify(cfg));
}

// =============================================================================
// Settings modal
// =============================================================================
(function initSettings() {
  const overlay       = document.getElementById("settings-overlay");
  const firebaseFields = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "databaseURL", "measurementId", "hostedUrl"];
  const azureFields    = ["cosmosConnection", "signalrConnection", "azureUrl", "cosmosDb", "cosmosContainer", "signalrHub"];

  // ── Tab switching ──
  document.querySelectorAll(".stab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".stab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".stab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  function openModal() {
    const cfg  = loadConfig();
    const acfg = loadAzureConfig();
    firebaseFields.forEach(k => {
      const el = document.getElementById("cfg-" + k);
      if (el) el.value = cfg[k] || "";
    });
    azureFields.forEach(k => {
      const el = document.getElementById("cfg-" + k);
      if (el) el.value = acfg[k] || "";
    });
    // Reset to Firebase tab on each open
    document.querySelectorAll(".stab").forEach(b => b.classList.toggle("active", b.dataset.tab === "tab-firebase"));
    document.querySelectorAll(".stab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-firebase"));
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
    // Save Firebase config
    const cfg = {};
    firebaseFields.forEach(k => {
      cfg[k] = (document.getElementById("cfg-" + k).value || "").trim();
    });
    saveConfig(cfg);

    // Save Azure config separately
    const acfg = {};
    azureFields.forEach(k => {
      acfg[k] = (document.getElementById("cfg-" + k).value || "").trim();
    });
    saveAzureConfig(acfg);

    closeModal();
    window.location.reload();
  });

  document.getElementById("launch-wizard-btn").addEventListener("click", () => {
    closeModal();
    window._openWizard && window._openWizard();
  });

  // ── Firebase Rules Helper ──────────────────────────────────────────────────
  (function initRulesHelper() {
    const select   = document.getElementById("rules-expiry-select");
    const snippet  = document.getElementById("rules-snippet");
    const copyBtn  = document.getElementById("rules-copy-btn");
    const badge    = document.getElementById("rules-status-badge");

    function msForOption(val) {
      const now = Date.now();
      if (val === "1y") return now + 365  * 24 * 60 * 60 * 1000;
      if (val === "2y") return now + 730  * 24 * 60 * 60 * 1000;
      if (val === "5y") return now + 1825 * 24 * 60 * 60 * 1000;
      return null; // never
    }

    function buildSnippet(val) {
      const ts = msForOption(val);
      if (ts === null) {
        return `{\n  "rules": {\n    ".read": true,\n    ".write": true\n  }\n}`;
      }
      const expDate = new Date(ts).toISOString().slice(0, 10);
      return `{\n  "rules": {\n    ".read": "now < ${ts}",  // ${expDate}\n    ".write": "now < ${ts}"  // ${expDate}\n  }\n}`;
    }

    function updateBadge() {
      // Check if current rules are expired by testing locationsRef connection
      if (!locationsRef) {
        badge.textContent = "Not connected";
        badge.className = "rules-badge rules-badge-error";
      } else {
        badge.textContent = "";
      }
    }

    function refresh() {
      snippet.textContent = buildSnippet(select.value);
      updateBadge();
    }

    select.addEventListener("change", refresh);
    refresh();

    copyBtn.addEventListener("click", () => {
      const text = snippet.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy Rules"; }, 2000);
        });
      } else {
        prompt("Copy these rules:", text);
      }
    });

    // Refresh badge whenever the modal opens
    const origOpen = window._settingsOpenHook;
    window._settingsOpenHook = function() { refresh(); if (origOpen) origOpen(); };
  })();
})();

// -- Session identity ---------------------------------------------------------
// Use localStorage (not sessionStorage) so each device keeps the same ID
// across tab closes, refreshes, and mobile browser restarts — preventing
// duplicate pins from the same device.
let sessionId = localStorage.getItem("locationMapSessionId");
if (!sessionId) {
  sessionId = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  localStorage.setItem("locationMapSessionId", sessionId);
}

// -- Mode detection -----------------------------------------------------------
const isHost = !new URLSearchParams(window.location.search).has("user");

document.getElementById("app").style.display       = isHost ? "flex" : "none";
document.getElementById("user-view").style.display = isHost ? "none" : "flex";

// =============================================================================
// Setup wizard — auto-opens on first run if Firebase is not configured
// =============================================================================
(function initWizard() {
  const overlay = document.getElementById("wizard-overlay");
  const dots    = Array.from(overlay.querySelectorAll(".wdot"));
  const steps   = Array.from(overlay.querySelectorAll(".wz-step"));
  const FIELDS  = ["apiKey", "authDomain", "databaseURL", "projectId",
                   "storageBucket", "messagingSenderId", "appId", "measurementId"];
  let current = 0;

  function showStep(n) {
    steps.forEach((s, i) => s.classList.toggle("active", i === n));
    dots.forEach((d, i)  => d.classList.toggle("active", i === n));
    current = n;
    overlay.querySelector("#wizard-modal").scrollTop = 0;
  }

  function open() {
    const cfg = loadConfig();
    FIELDS.forEach(k => {
      const el = document.getElementById("wz-" + k);
      if (el) el.value = cfg[k] || "";
    });
    const hostedEl = document.getElementById("wz-hostedUrl");
    if (hostedEl) hostedEl.value = cfg.hostedUrl || "";
    document.getElementById("wz-error").textContent = "";
    overlay.classList.add("open");
    showStep(0);
  }

  function close() {
    overlay.classList.remove("open");
  }

  // Expose for external callers (settings modal)
  window._openWizard = open;

  // X close button
  document.getElementById("wizard-close").addEventListener("click", () => {
    localStorage.setItem("mapplot_wizard_done", "1");
    close();
  });

  // Next buttons
  overlay.querySelectorAll(".wz-next-btn").forEach(btn =>
    btn.addEventListener("click", () => showStep(current + 1))
  );

  // Back buttons
  overlay.querySelectorAll(".wz-back-btn").forEach(btn =>
    btn.addEventListener("click", () => showStep(current - 1))
  );

  // Skip (step 0 only)
  overlay.querySelectorAll(".wz-skip-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      localStorage.setItem("mapplot_wizard_done", "1");
      close();
    })
  );

  // Save config (step 3)
  document.getElementById("wz-save-btn").addEventListener("click", () => {
    const databaseURL = (document.getElementById("wz-databaseURL").value || "").trim();
    const errEl = document.getElementById("wz-error");
    if (!databaseURL) {
      errEl.textContent = "Database URL is required.";
      document.getElementById("wz-databaseURL").focus();
      return;
    }
    errEl.textContent = "";
    const cfg = loadConfig();
    FIELDS.forEach(k => {
      const v = (document.getElementById("wz-" + k).value || "").trim();
      if (v) cfg[k] = v;
    });
    saveConfig(cfg);
    showStep(4);
  });

  // Finish (step 4)
  document.getElementById("wz-finish-btn").addEventListener("click", () => {
    const hosted = (document.getElementById("wz-hostedUrl").value || "").trim();
    if (hosted) {
      const cfg = loadConfig();
      cfg.hostedUrl = hosted;
      saveConfig(cfg);
    }
    localStorage.setItem("mapplot_wizard_done", "1");
    close();
    window.location.reload();
  });

  // Block Enter inside wizard inputs from accidentally advancing
  overlay.querySelectorAll("input").forEach(input =>
    input.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); })
  );

  // Auto-open on first run in host mode when Firebase is not configured
  if (isHost && !isConfigured() && !localStorage.getItem("mapplot_wizard_done")) {
    open();
  }
})();

// =============================================================================
// User guide
// =============================================================================
(function initGuide() {
  const overlay = document.getElementById("guide-overlay");

  function open()  { overlay.classList.add("open"); }
  function close() { overlay.classList.remove("open"); }

  document.getElementById("guide-btn")  .addEventListener("click", open);
  document.getElementById("guide-close").addEventListener("click", close);

  // Click backdrop to close
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("open")) close();
  });
})();

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

  // rows = array of RTDB values: { session_id, display_name, lat, lon, location_key }
  function render(rows) {
    Object.values(rendered).forEach(loc => loc.marker && loc.marker.remove());
    Object.keys(rendered).forEach(k => delete rendered[k]);

    // Skip any malformed entries that are missing required fields
    const validRows = rows.filter(row =>
      row && row.location_key && row.display_name &&
      typeof row.lat === "number" && typeof row.lon === "number"
    );

    validRows.forEach(row => {
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

    const totalUsers = validRows.length;
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

  // Real-time listener — Realtime Database
  if (!locationsRef) {
    liveDot.classList.add("error");
    liveDot.title = "Not configured — open ⚙ Settings to connect Firebase";
  } else {
  liveDot.classList.add("connecting");
  liveDot.title = "Connecting to Firebase…";

  locationsRef.on("value",
    snapshot => {
      liveDot.classList.remove("connecting", "error");
      liveDot.classList.add("connected");
      liveDot.title = "Live — syncing in real time";
      const val = snapshot.val() || {};
      render(Object.values(val));
    },
    err => {
      liveDot.classList.remove("connecting", "connected");
      liveDot.classList.add("error");
      const hint = err.code === "PERMISSION_DENIED"
        ? "Permission denied — set .read and .write to true in Firebase Rules"
        : "Connection error — check Firebase config in ⚙ Settings";
      liveDot.title = hint;
      console.error("Realtime Database error:", err);
    }
  );
  }

  document.getElementById("reset-btn").addEventListener("click", async () => {
    if (confirm("This will clear ALL pins for everyone. Continue?")) {
      await locationsRef.remove();
      map.setView([20, 0], 2);
    }
  });

  document.getElementById("copy-link-btn").addEventListener("click", () => {
    const cfg      = loadConfig();
    const base     = (cfg.hostedUrl || window.location.origin).replace(/\/$/, '');
    const encoded  = btoa(JSON.stringify(cfg));
    const userLink = `${base}/?user#cfg=${encoded}`;
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
        throw new Error("Link is missing configuration. Ask the host to re-copy and re-share the user link.");
      }

      // Race the RTDB write against a timeout.
      let firebaseError = null;
      const writePromise = locationsRef.child(sessionId).set({
        session_id:   sessionId,
        display_name: result.displayName,
        lat:          result.lat,
        lon:          result.lon,
        location_key: result.locationKey,
        updated_at:   firebase.database.ServerValue.TIMESTAMP,
      }).catch(err => { firebaseError = err; throw err; });

      await withTimeout(
        writePromise,
        10000,
        firebaseError
          ? firebaseError.message
          : "Could not reach Firebase — check your Settings and Database rules."
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
