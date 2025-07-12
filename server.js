const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // For making HTTP requests

const app = express();
const PORT = process.env.PORT || 10000; // Render will provide a PORT environment variable

// Enable CORS for all origins (adjust if you need stricter control)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For'],
    credentials: true // Allow cookies and auth headers to be sent
}));

// Use express.json() to parse JSON request bodies
app.use(express.json());
// Use express.text() to handle raw text bodies, important for SSE
app.use(express.text({ type: 'text/event-stream' }));
app.use(express.text({ type: 'application/json' })); // Also handle JSON as text for flexibility

// Main proxy endpoint
// This endpoint will take the target URL from the request body or query parameter
// and proxy the request to it.
app.all('*', async (req, res) => { // Use app.all to handle GET, POST, etc.
    // Determine the target URL from a custom header or query parameter
    // For simplicity, let's assume it comes from a query parameter 'targetUrl'
    // or a custom header 'X-Target-Url'.
    // In our case, the PHP script will provide the full Gradio URL in the body/header.

    const targetUrl = req.headers['x-target-url'] || req.query.targetUrl; // PHP will send X-Target-Url
    const method = req.method;
    const requestHeaders = req.headers;
    const requestBody = req.body;

    if (!targetUrl) {
        return res.status(400).send('Target URL not provided. Please provide X-Target-Url header or targetUrl query parameter.');
    }

    // Filter out hop-by-hop headers and our custom proxy headers
    const filteredHeaders = {};
    for (const key in requestHeaders) {
        if (!['host', 'connection', 'x-forwarded-for', 'x-target-url', 'accept-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
            filteredHeaders[key] = requestHeaders[key];
        }
    }

    try {
        const fetchOptions = {
            method: method,
            headers: filteredHeaders,
            redirect: 'follow', // Follow redirects on the target server
            compress: false, // Don't compress responses, especially for SSE
            // Disable default browser's credentials sending for security (we forward them explicitly if needed)
            // credentials: 'omit', 
        };

        if (method !== 'GET' && method !== 'HEAD') {
            // For POST/PUT/DELETE, send the body
            fetchOptions.body = requestBody;
        }

        console.log(`Proxying ${method} request to: ${targetUrl}`);
        // console.log('Request body:', requestBody ? requestBody.substring(0, 200) + '...' : 'None');
        // console.log('Request headers:', filteredHeaders);


        // Important for SSE: Stream the response back to the client
        const proxyResponse = await fetch(targetUrl, fetchOptions);

        // Set response headers from the proxy target
        proxyResponse.headers.forEach((value, name) => {
            // Filter out hop-by-hop headers for the final response
            if (!['transfer-encoding', 'connection', 'content-encoding'].includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });

        // Set the status code
        res.status(proxyResponse.status);

        // Stream the response body directly
        proxyResponse.body.pipe(res);

    } catch (error) {
        console.error('Proxy error:', error);
        if (!res.headersSent) { // Only send error if headers haven't been sent yet (e.g., for SSE that started streaming)
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    }
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
