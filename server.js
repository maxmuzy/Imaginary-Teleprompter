const express = require('express');
const path = require('path');
const app = express();
const PORT = 5000;

// Serve static files from the root directory
app.use(express.static(__dirname));

// Serve index.html for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Imaginary Teleprompter running at http://0.0.0.0:${PORT}`);
  console.log('Open the webview to access the teleprompter application');
});
