const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  const win = new BrowserWindow({
    width:  1280,
    height: 860,
    minWidth:  900,
    minHeight: 600,
    icon: iconPath,
    title: 'MapPlot',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // Allow loading CDN scripts (Firebase, Leaflet) from file:// context
      webSecurity: true,
    },
    show: false, // show after ready-to-show to avoid white flash
  });

  // Allow Firebase + CDN resources from file:// context
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:",
        ],
      },
    });
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // Show once fully loaded — no white flash
  win.once('ready-to-show', () => win.show());

  // Open all target="_blank" links in the system browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Remove default menu bar (keeps the app clean)
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
