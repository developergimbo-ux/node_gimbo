const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for any unknown route
app.get('/', (req, res) => {
  res.status(200).send('OK');
});


app.listen(PORT, () => {
  console.log(`✅  GYM Portal running at http://localhost:${PORT}`);
});
