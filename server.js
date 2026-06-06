const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Serves static files (index.html, app.js, styles.css) for local dev.
// The PocketBase backend must be running separately: ./pocketbase serve
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Static server  ->  http://localhost:${PORT}`);
  console.log(`PocketBase API ->  http://127.0.0.1:8090`);
  console.log('');
  console.log('Make sure PocketBase is running: ./pocketbase serve');
});
