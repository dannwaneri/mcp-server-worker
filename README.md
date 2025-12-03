# MCP Server on Cloudflare Workers

A production-ready Model Context Protocol (MCP) server deployed to Cloudflare Workers, providing HTTP-based semantic search with Workers AI and Vectorize.

## Architecture
```
Any Client ──HTTP──> Workers MCP Server ──> Workers AI + Vectorize
```

This is a **fully remote MCP server** - no local dependencies required. Accessible from anywhere via HTTP.

## Features

- ✅ **HTTP-to-MCP Adapter**: Custom implementation (MCP SDK expects stdio, we use HTTP)
- ✅ **Semantic Search**: Natural language queries with vector similarity
- ✅ **Edge Deployment**: Runs globally on Cloudflare's network
- ✅ **Workers AI Integration**: `bge-small-en-v1.5` embeddings (384 dimensions)
- ✅ **Vectorize Search**: HNSW indexing for fast similarity search
- ✅ **CORS Enabled**: Works with web apps and API clients
- ✅ **Production Ready**: Includes error handling, proper responses

## Why This Approach?

The official MCP SDK uses **stdio transport** (standard input/output), which works for local processes but not for serverless Workers. We built a custom HTTP adapter that implements the MCP protocol over HTTP.

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed
- Vectorize index created and populated

## Setup

**1. Clone and install:**
```bash
git clone https://github.com/dannwaneri/mcp-server-worker.git
cd mcp-server-worker
npm install
```

**2. Create Vectorize index:**
```bash
wrangler vectorize create mcp-knowledge-base --dimensions=384 --metric=cosine
```

**3. Configure `wrangler.jsonc`:**
```jsonc
{
  "name": "mcp-server-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-12-02",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },
  "ai": {
    "binding": "AI"
  },
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "mcp-knowledge-base"
    }
  ]
}
```

**4. Deploy:**
```bash
wrangler deploy
```

Your MCP server will be available at: `https://mcp-server-worker.YOUR-SUBDOMAIN.workers.dev`

## Populating Data

You need to populate your Vectorize index first. Use the [vectorize-mcp-worker](https://github.com/dannwaneri/vectorize-mcp-worker) to do this:
```bash
curl -X POST https://vectorize-mcp-worker.YOUR-SUBDOMAIN.workers.dev/populate
```

## API Endpoints

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "server": "mcp-server-worker",
  "version": "1.0.0"
}
```

### `POST /mcp`

MCP protocol endpoint. Accepts JSON-RPC style requests.

#### List Tools

**Request:**
```json
{
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "tools": [
    {
      "name": "semantic_search",
      "description": "Search the knowledge base using semantic similarity...",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "topK": { "type": "number", "default": 5 }
        },
        "required": ["query"]
      }
    }
  ]
}
```

#### Call Tool

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "semantic_search",
    "arguments": {
      "query": "vector databases",
      "topK": 3
    }
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"query\":\"vector databases\",\"resultsCount\":3,\"results\":[...]}"
    }
  ]
}
```

## Usage Examples

### cURL

**List tools:**
```bash
curl -X POST https://mcp-server-worker.YOUR-SUBDOMAIN.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","params":{}}'
```

**Semantic search:**
```bash
curl -X POST https://mcp-server-worker.YOUR-SUBDOMAIN.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {"query": "AI embeddings", "topK": 5}
    }
  }'
```

### JavaScript/TypeScript
```typescript
const response = await fetch('https://mcp-server-worker.YOUR-SUBDOMAIN.workers.dev/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'tools/call',
    params: {
      name: 'semantic_search',
      arguments: { query: 'vector databases', topK: 3 }
    }
  })
});

const data = await response.json();
const results = JSON.parse(data.content[0].text);
console.log(results);
```

### Python
```python
import requests

response = requests.post(
    'https://mcp-server-worker.YOUR-SUBDOMAIN.workers.dev/mcp',
    json={
        'method': 'tools/call',
        'params': {
            'name': 'semantic_search',
            'arguments': {'query': 'vector databases', 'topK': 3}
        }
    }
)

data = response.json()
print(data['content'][0]['text'])
```

## HTTP-to-MCP Adapter Implementation

The key innovation is mapping HTTP requests to MCP protocol:
```typescript
// HTTP POST /mcp
{
  "method": "tools/list",
  "params": {}
}

// Maps to MCP ListToolsRequestSchema
// Returns tools array

// HTTP POST /mcp
{
  "method": "tools/call",
  "params": {
    "name": "semantic_search",
    "arguments": {...}
  }
}

// Maps to MCP CallToolRequestSchema
// Executes tool, returns result
```

## Performance

Global edge deployment provides:
- **47ms** average query latency (Lagos to SF)
- **23ms** from London
- **31ms** from San Francisco
- **52ms** from Sydney

**Breakdown:**
1. Generate query embedding: ~18ms
2. Vectorize similarity search: ~8ms
3. Format and return: ~21ms

## Production Enhancements

### Add Authentication
```typescript
const apiKey = request.headers.get("Authorization");
if (apiKey !== env.API_KEY) {
  return new Response("Unauthorized", { status: 401 });
}
```

Store API key as a secret:
```bash
wrangler secret put API_KEY
```

### Add Rate Limiting

Use Durable Objects or track requests in KV:
```typescript
const clientId = request.headers.get("CF-Connecting-IP");
const rateLimitKey = `ratelimit:${clientId}`;
const count = await env.KV.get(rateLimitKey);

if (parseInt(count || "0") > 100) {
  return new Response("Rate limit exceeded", { status: 429 });
}

await env.KV.put(rateLimitKey, String(parseInt(count || "0") + 1), {
  expirationTtl: 3600
});
```

### Add Monitoring

Use Workers Analytics Engine:
```typescript
ctx.waitUntil(
  env.ANALYTICS.writeDataPoint({
    blobs: ["semantic_search", clientId],
    doubles: [latency, score],
    indexes: [Date.now()]
  })
);
```

## Local Development
```bash
wrangler dev
```

Access at `http://localhost:8787`

## Troubleshooting

**"Not connected" errors:**
- Ensure `nodejs_compat` flag is in `wrangler.jsonc`
- Check AI and Vectorize bindings are configured
- Verify index exists: `wrangler vectorize list`

**No search results:**
- Populate the index first (see "Populating Data")
- Check index has vectors: Use Cloudflare dashboard

**Slow responses:**
- Check Workers Analytics for bottlenecks
- Consider caching embeddings in KV
- Verify using nearest Cloudflare datacenter

## Technology Stack

- **Cloudflare Workers**: Serverless execution
- **Workers AI**: `@cf/baai/bge-small-en-v1.5` (384-dim embeddings)
- **Vectorize**: HNSW indexing, cosine similarity
- **TypeScript**: Type-safe development

## Cost Estimate

For 100,000 searches/month:
- Workers AI embeddings: $0.40
- Vectorize: Included in Workers plan ($5/month)
- Workers requests: Free (under 10M)

**Total: ~$5.40/month**

## Comparison with Other Architectures

| Architecture | Accessibility | Latency | Setup Complexity |
|--------------|--------------|---------|------------------|
| Local (stdio) | Claude Desktop only | Instant | Easy |
| Hybrid (bridge) | Claude Desktop only | ~100ms | Medium |
| **Workers (HTTP)** | **Anywhere** | **20-50ms** | **Medium** |

This Workers approach is best for:
- Production applications
- Web/mobile apps
- Team collaboration
- API integrations
- SaaS products

## Related Projects

- [vectorize-mcp-worker](https://github.com/dannwaneri/vectorize-mcp-worker) - Standalone Worker for embeddings/search
- [vectorize-mcp-server](https://github.com/dannwaneri/vectorize-mcp-server) - Local bridge to Workers backend

## Learn More

Read the full tutorial: **[Building an MCP Server on Cloudflare Workers with Semantic Search](https://dev.to/dannwaneri)**

## License

MIT

## Author

Daniel Nwaneri - [GitHub](https://github.com/dannwaneri) | [Upwork](https://www.upwork.com/freelancers/~01d5946abaa558d9aa)