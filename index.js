// index.js (for your Render.com service)

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json()); // To parse JSON bodies

const PORT = process.env.PORT || 10000; // Render sets the PORT environment variable
const GRADIO_API_URL = 'https://coherelabs-aya-expanse.hf.space/gradio_api';

// Health check endpoint
app.get('/', (req, res) => {
  res.send('AyaChat Proxy is running!');
});

// Endpoint to handle the /queue/join request
app.post('/queue/join', async (req, res) => {
  console.log('Received /queue/join request with body:', JSON.stringify(req.body));
  try {
    const response = await fetch(`${GRADIO_API_URL}/queue/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    console.log('Response from Gradio /queue/join:', JSON.stringify(data));
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error in /queue/join proxy:', error);
    res.status(500).json({ error: 'Failed to connect to Gradio service (join).' });
  }
});

// Endpoint to handle the streaming /queue/data request (SSE)
app.get('/queue/data', async (req, res) => {
  const sessionHash = req.query.session_hash;
  if (!sessionHash) {
    return res.status(400).send('session_hash is required');
  }

  console.log(`Proxying SSE for session_hash: ${sessionHash}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Flush the headers to establish the connection

  try {
    const sseUrl = `${GRADIO_API_URL}/queue/data?session_hash=${sessionHash}`;
    const response = await fetch(sseUrl);

    if (!response.ok) {
      throw new Error(`Gradio SSE endpoint returned status ${response.status}`);
    }

    // Pipe the response body from Gradio directly to the client
    response.body.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`Client disconnected for session_hash: ${sessionHash}`);
      // node-fetch doesn't have a direct way to abort the request once piped,
      // but the connection will be closed.
    });
  } catch (error) {
    console.error(`Error in SSE proxy for session_hash ${sessionHash}:`, error);
    res.end(); // Close the connection on error
  }
});

app.listen(PORT, () => {
  console.log(`AyaChat Proxy server listening on port ${PORT}`);
});
