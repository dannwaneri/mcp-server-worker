export interface Env {
	AI: Ai;
	VECTORIZE: VectorizeIndex;
}

// MCP request types
interface MCPRequest {
	method: string;
	params?: any;
}

interface MCPToolCallRequest extends MCPRequest {
	method: "tools/call";
	params: {
		name: string;
		arguments?: any;
	};
}

// HTTP-to-MCP adapter - Direct implementation
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		// Health check
		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({
					status: "ok",
					server: "mcp-server-worker",
					version: "1.0.0",
				}),
				{
					headers: { "Content-Type": "application/json", ...corsHeaders },
				}
			);
		}

		// MCP endpoint - Direct handling
		if (url.pathname === "/mcp" && request.method === "POST") {
			try {
				const mcpRequest = (await request.json()) as MCPRequest;

				// Handle tools/list
				if (mcpRequest.method === "tools/list") {
					return new Response(
						JSON.stringify({
							tools: [
								{
									name: "semantic_search",
									description:
										"Search the knowledge base using semantic similarity. Finds content based on meaning, not just keywords.",
									inputSchema: {
										type: "object",
										properties: {
											query: {
												type: "string",
												description: "Natural language search query",
											},
											topK: {
												type: "number",
												description: "Number of results to return (1-10)",
												default: 5,
											},
										},
										required: ["query"],
									},
								},
								{
									name: "intelligent_search",
									description: "Search with AI-powered synthesis. Returns search results plus context for intelligent answer generation.",
									inputSchema: {
									  type: "object",
									  properties: {
										query: {
										  type: "string",
										  description: "Question or search query",
										},
										topK: {
										  type: "number",
										  description: "Number of results to retrieve (1-10)",
										  default: 3,
										},
									  },
									  required: ["query"],
									},
								  },
							],
						}),
						{
							headers: { "Content-Type": "application/json", ...corsHeaders },
						}
					);
				}

				// Handle tools/call
				if (mcpRequest.method === "tools/call") {
					const callRequest = mcpRequest as MCPToolCallRequest;
					const { name, arguments: args } = callRequest.params;

					if (name === "semantic_search") {
						const query = args?.query as string;
						const topK = Math.min((args?.topK as number) || 5, 10);

						if (!query) {
							throw new Error("Query parameter is required");
						}

						// Generate embedding
						const response = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
							text: query,
						});

						const queryEmbedding = Array.isArray(response) ? response : (response as any).data[0];

						// Search Vectorize
						const results = await env.VECTORIZE.query(queryEmbedding, {
							topK,
							returnMetadata: true,
						});

						return new Response(
							JSON.stringify({
								content: [
									{
										type: "text",
										text: JSON.stringify(
											{
												query,
												resultsCount: results.matches.length,
												results: results.matches.map((match) => ({
													id: match.id,
													score: match.score.toFixed(4),
													content: match.metadata?.content,
													category: match.metadata?.category,
												})),
											},
											null,
											2
										),
									},
								],
							}),
							{
								headers: { "Content-Type": "application/json", ...corsHeaders },
							}
						);
					}


					if (name === "intelligent_search") {
						const query = args?.query as string;
						const topK = Math.min((args?.topK as number) || 3, 10);
					  
						if (!query) {
						  throw new Error("Query parameter is required");
						}
					  
						// Generate embedding
						const response = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
						  text: query,
						});
					  
						const queryEmbedding = Array.isArray(response) ? response : (response as any).data[0];
					  
						// Search Vectorize
						const searchResults = await env.VECTORIZE.query(queryEmbedding, {
						  topK,
						  returnMetadata: true,
						});
					  
						// Format results for synthesis
						const resultsForSynthesis = searchResults.matches
						  .map((match, idx) => {
							return `[${idx + 1}] Relevance: ${match.score.toFixed(2)}
					  Content: ${match.metadata?.content}
					  Category: ${match.metadata?.category}`;
						  })
						  .join("\n\n");
					  
						const responseText = JSON.stringify(
						  {
							query,
							resultsCount: searchResults.matches.length,
							searchResults: searchResults.matches.map((match) => ({
							  id: match.id,
							  score: match.score.toFixed(4),
							  content: match.metadata?.content,
							  category: match.metadata?.category,
							})),
							synthesisContext: `Answer this question: "${query}"
					  
					  Based on these search results:
					  
					  ${resultsForSynthesis}
					  
					  Provide a direct, concise answer using only the information above.`,
						  },
						  null,
						  2
						);
					  
						return new Response(
						  JSON.stringify({
							content: [
							  {
								type: "text",
								text: responseText,
							  },
							],
						  }),
						  {
							headers: { "Content-Type": "application/json", ...corsHeaders },
						  }
						);
					  }

					throw new Error(`Unknown tool: ${name}`);
				}

				throw new Error(`Unsupported MCP method: ${mcpRequest.method}`);
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: error instanceof Error ? error.message : "Unknown error",
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...corsHeaders },
					}
				);
			}
		}

		// Default response
		return new Response(
			"MCP Server on Cloudflare Workers\n\nEndpoints:\nPOST /mcp - MCP protocol endpoint\nGET /health - Health check",
			{
				headers: { "Content-Type": "text/plain", ...corsHeaders },
			}
		);
	},
};