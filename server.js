const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for all origins (adjust if you need stricter control)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For'],
    credentials: true
}));

// IMPORTANT CHANGE HERE: Use express.raw() to get the raw body as a Buffer
// This avoids express trying to parse it as JSON or text automatically.
// We will manually parse it as JSON string later if needed.
app.use(express.raw({ type: 'application/json' })); // For JSON bodies
app.use(express.raw({ type: 'text/event-stream' })); // For SSE (though not directly used for parsing body)
app.use(express.raw({ type: '*/*' })); // Catch all other content types as raw

// Main proxy endpoint
app.all('*', async (req, res) => {
    const targetUrl = req.headers['x-target-url'] || req.query.targetUrl;
    const method = req.method;
    const requestHeaders = req.headers;
    let requestBody = req.body; // This will be a Buffer due to express.raw()

    if (!targetUrl) {
        return res.status(400).send('Target URL not provided. Please provide X-Target-Url header or targetUrl query parameter.');
    }

    // Attempt to parse body as JSON if Content-Type is application/json
    let parsedBody = null;
    if (requestHeaders['content-type'] && requestHeaders['content-type'].includes('application/json')) {
        try {
            // Convert Buffer to string before parsing JSON
            parsedBody = JSON.parse(requestBody.toString('utf8'));
            // console.log('Parsed JSON body:', parsedBody);
        } catch (e) {
            console.error('Failed to parse JSON body:', e.message);
            // If JSON parsing fails, send back a 422 error
            return res.status(422).json({
                detail: {
                    type: "json_invalid",
                    loc: ["body"],
                    msg: "JSON decode error",
                    input: {},
                    ctx: { error: "Failed to parse request body as JSON: " + e.message }
                }
            });
        }
    } else if (requestBody instanceof Buffer) {
        // If not JSON and still a buffer, convert to string
        requestBody = requestBody.toString('utf8');
    }

    // Filter out hop-by-hop headers and our custom proxy headers
    const filteredHeaders = {};
    for (const key in requestHeaders) {
        if (!['host', 'connection', 'x-forwarded-for', 'x-target-url', 'accept-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
            filteredHeaders[key] = requestHeaders[key];
        }
    }
    // Re-add content-length header if there was a body, but calculate it again based on final body string/buffer
    if (parsedBody) {
        const bodyString = JSON.stringify(parsedBody);
        filteredHeaders['content-length'] = Buffer.byteLength(bodyString, 'utf8');
    } else if (typeof requestBody === 'string') {
        filteredHeaders['content-length'] = Buffer.byteLength(requestBody, 'utf8');
    }


    try {
        const fetchOptions = {
            method: method,
            headers: filteredHeaders,
            redirect: 'follow',
            compress: false,
        };

        if (method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = parsedBody ? JSON.stringify(parsedBody) : requestBody;
        }

        console.log(`Proxying ${method} request to: ${targetUrl}`);

        const proxyResponse = await fetch(targetUrl, fetchOptions);

        proxyResponse.headers.forEach((value, name) => {
            if (!['transfer-encoding', 'connection', 'content-encoding'].includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });

        res.status(proxyResponse.status);

        proxyResponse.body.pipe(res);

    } catch (error) {
        console.error('Proxy error:', error);
        if (!res.headersSent) {
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    }
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
