/**
 * Ollama Integration Module
 * 
 * This module provides an interface to the Ollama API for local LLM inference.
 * Ollama allows running large language models (LLMs) locally without requiring
 * cloud API keys or network access to external services.
 * 
 * Features:
 * - Streaming chat responses for real-time typing effect
 * - Model listing to see available local models
 * - Non-streaming chat for complete responses
 * - Custom host configuration for remote Ollama instances
 * - System prompt engineering for consistent code formatting
 * 
 * The module wraps the official 'ollama' npm package and provides:
 * - Type-safe interfaces
 * - Error handling
 * - Streaming support with async generators
 * - Message history management
 * 
 * Ollama API Documentation: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

// =============================================================================
// EXTERNAL IMPORTS
// =============================================================================

import ollama, { Ollama } from 'ollama'  // Official Ollama JavaScript client
import type { ChatMessage } from '../types'  // Our internal message type

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Configuration for Ollama API connections.
 * 
 * @property host - Optional custom host URL (default: localhost:11434)
 * @property model - Name of the model to use (e.g., 'llama3.2', 'qwen2.5')
 * 
 * @example
 * { model: 'llama3.2' }  // Use default localhost
 * { host: 'http://192.168.1.100:11434', model: 'qwen2.5' }  // Remote instance
 */
export interface OllamaConfig {
  /** Optional custom host URL for Ollama server */
  host?: string
  /** Name of the model to use for inference */
  model: string
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

/**
 * System prompt that sets the behavior and formatting expectations for the AI.
 * 
 * The system prompt is sent as the first message and instructs the model on:
 * - Its role (helpful coding assistant)
 * - Output format (markdown code blocks)
 * - Code formatting requirements
 * 
 * This prompt engineering ensures consistent, well-formatted code output
 * that renders nicely in our TUI with syntax highlighting.
 * 
 * Why this matters:
 * - Without guidance, models output code inconsistently
 * - Proper markdown enables our syntax highlighter to work
 * - Code blocks improve readability in terminal UI
 */
const SYSTEM_PROMPT = `You are a helpful coding assistant. When providing code examples, always use markdown code blocks with triple backticks and specify the language.

For example:
\`\`\`javascript
function example() {
  return "hello";
}
\`\`\`

Format all code with proper markdown code blocks, language labels, and indentation.`

// =============================================================================
// STREAMING CHAT
// =============================================================================

/**
 * Stream chat responses from Ollama in real-time.
 * 
 * This function sends the conversation history to Ollama and yields response
 * chunks as they're generated. This creates a "typing effect" where the user
 * sees the response appear character by character (or token by token).
 * 
 * Streaming is implemented using JavaScript async generators (async function*).
 * Each yield provides the next chunk of text, allowing the caller to process
 * it immediately rather than waiting for the complete response.
 * 
 * Implementation Details:
 * - Prepends system prompt to message history
 * - Creates Ollama client (default or custom host)
 * - Sends chat request with streaming enabled
 * - Yields each chunk as it arrives from the model
 * - Handles the streaming response from Ollama's API
 * 
 * @param config - Ollama configuration (model name, optional host)
 * @param messages - Array of chat messages (conversation history)
 * @returns AsyncGenerator<string> - Yields response chunks as they're generated
 * 
 * @example
 * const messages = [{ role: 'user', content: 'Hello!', timestamp: Date.now() }]
 * for await (const chunk of streamChat({ model: 'llama3.2' }, messages)) {
 *   process.stdout.write(chunk)  // Prints chunks as they arrive
 * }
 */
export async function* streamChat(
  config: OllamaConfig,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  // -------------------------------------------------------------------------
  // Prepare messages for Ollama API
  // -------------------------------------------------------------------------
  // The API expects messages in format: { role: 'system'|'user'|'assistant', content: string }
  // We prepend the system prompt to set the model's behavior
  const ollamaMessages = [
    // System prompt as first message (instructs the model)
    { role: 'system' as const, content: SYSTEM_PROMPT },
    // Map our internal ChatMessage format to Ollama's expected format
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',  // Cast role to literal type
      content: m.content,
    }))
  ]

  // -------------------------------------------------------------------------
  // Create Ollama client
  // -------------------------------------------------------------------------
  // If a custom host is provided, create a new Ollama instance with that host
  // Otherwise, use the default ollama singleton (connects to localhost:11434)
  const client = config.host
    ? new Ollama({ host: config.host })
    : ollama

  // -------------------------------------------------------------------------
  // Send streaming chat request
  // -------------------------------------------------------------------------
  // stream: true tells Ollama to send response chunks as they're generated
  // rather than waiting for the complete response
  const stream = await client.chat({
    model: config.model,
    messages: ollamaMessages,
    stream: true,  // Enable streaming mode
  })

  // -------------------------------------------------------------------------
  // Yield response chunks
  // -------------------------------------------------------------------------
  // The stream is an async iterable that yields response objects
  // Each object contains a chunk of the generated text
  for await (const chunk of stream) {
    // Check if this chunk contains message content
    if (chunk.message?.content) {
      yield chunk.message.content  // Yield the text chunk to the caller
    }
  }
}

// =============================================================================
// MODEL LISTING
// =============================================================================

/**
 * List all available models in the Ollama instance.
 * 
 * Queries the Ollama server for all downloaded/available models and returns
 * their names. This is used by the --list-models CLI flag to show users
 * which models they can use.
 * 
 * @param config - Ollama configuration (optional custom host)
 * @returns Promise<string[]> - Array of available model names
 * 
 * @example
 * const models = await listModels({ model: 'dummy' })
 * console.log(models)  // ['llama3.2', 'qwen2.5', 'mistral:latest']
 */
export async function listModels(config: OllamaConfig): Promise<string[]> {
  // Create client (default localhost or custom host)
  const client = config.host
    ? new Ollama({ host: config.host })
    : ollama

  // Query Ollama for available models
  const response = await client.list()
  
  // Extract model names from response
  // Response format: { models: [{ name: 'model:tag', ... }, ...] }
  return response.models.map((m: { name: string }) => m.name)
}

// =============================================================================
// NON-STREAMING CHAT
// =============================================================================

/**
 * Get a complete chat response from Ollama (non-streaming).
 * 
 * Unlike streamChat which yields chunks, this function aggregates all chunks
 * and returns the complete response as a single string. This is simpler to use
 * when you don't need real-time streaming.
 * 
 * Trade-offs:
 * - Pros: Simpler API, complete response available immediately
 * - Cons: User sees no feedback until entire response is generated
 *         (can feel slow for long responses)
 * 
 * This function is used by our application because we collect the complete
 * response before displaying it (avoiding flickering in the TUI).
 * 
 * @param config - Ollama configuration (model name, optional host)
 * @param messages - Array of chat messages (conversation history)
 * @returns Promise<string> - Complete response text
 * 
 * @example
 * const messages = [{ role: 'user', content: 'Explain OOP', timestamp: Date.now() }]
 * const response = await chat({ model: 'llama3.2' }, messages)
 * console.log(response)  // Complete response as a string
 */
export async function chat(
  config: OllamaConfig,
  messages: ChatMessage[]
): Promise<string> {
  let fullResponse = ''  // Accumulate all chunks here
  
  // Use streamChat internally but collect all chunks
  for await (const chunk of streamChat(config, messages)) {
    fullResponse += chunk  // Append each chunk to the full response
  }
  
  return fullResponse  // Return complete response
}

// =============================================================================
// USAGE NOTES
// =============================================================================

/**
 * Working with Ollama:
 * 
 * 1. Installation:
 *    - Install Ollama from https://ollama.com
 *    - Or run in Docker: docker run -d -v ollama:/root/.ollama -p 11434:11434 ollama/ollama
 * 
 * 2. Pulling Models:
 *    - ollama pull llama3.2
 *    - ollama pull qwen2.5
 *    - ollama pull mistral
 * 
 * 3. Running Models:
 *    - Models run automatically on first use
 *    - Or pre-load: ollama run llama3.2
 * 
 * 4. Configuration:
 *    - Default connects to localhost:11434
 *    - Set OLLAMA_HOST env var to change bind address
 *    - Use host parameter for remote Ollama instances
 * 
 * 5. Performance:
 *    - First run downloads model (can be GBs)
 *    - Subsequent runs use cached model
 *    - GPU acceleration available if configured
 * 
 * 6. Troubleshooting:
 *    - Check Ollama is running: curl http://localhost:11434/api/tags
 *    - Verify model is pulled: ollama list
 *    - Check logs: ollama logs
 * 
 * API Limitations:
 * - Maximum context window depends on model
 * - No built-in conversation memory (we handle this)
 * - No system prompt persistence (we send it each time)
 */
