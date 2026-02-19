/**
 * Application Entry Point
 * 
 * This is the main entry point for the Ollama Signal Chat application.
 * It handles CLI argument parsing, environment variable configuration,
 * and initializes the Ink TUI rendering engine.
 * 
 * The application is an end-to-end encrypted chat interface that uses
 * the Signal Protocol (Double Ratchet) for message encryption and
 * connects to Ollama for AI model responses.
 */

import React from 'react'
import { render } from 'ink'  // Ink is a React renderer for terminal UIs
import { App } from './app'
import type { AppConfig } from './types'

// =============================================================================
// CONFIGURATION DEFAULTS
// =============================================================================
// These constants define the default values used when no explicit configuration
// is provided via command-line arguments or environment variables.

/** Default directory for persistent encrypted session storage */
const DEFAULT_DATA_DIR = '/app/data'

/** Default Ollama model to use for chat responses */
const DEFAULT_MODEL = 'llama3.2'

// =============================================================================
// COMMAND-LINE ARGUMENT PARSING
// =============================================================================

/**
 * Parses command-line arguments and returns configuration object.
 * 
 * This function processes the command-line arguments (process.argv) to extract
 * user-specified options. It supports both long-form (--option) and short-form
 * (-o) arguments, and also checks for environment variables as fallback.
 * 
 * The function uses a simple loop-based parser that processes arguments
 * sequentially. For options that take values (like --model), it increments
 * the index to consume the value argument.
 * 
 * @returns AppConfig - Configuration object with parsed values
 */
function parseArgs(): AppConfig {
  // process.argv[0] is node/bun, process.argv[1] is the script path
  // We start from index 2 to get actual user-provided arguments
  const args = process.argv.slice(2)
  
  // Initialize configuration with default values
  // Environment variables take precedence over hardcoded defaults
  // Command-line arguments will override both
  const config: AppConfig = {
    model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    dataDir: process.env.DATA_DIR || DEFAULT_DATA_DIR,
    reset: false,        // By default, try to restore existing session
    listModels: false,   // By default, start chat mode
  }

  // Iterate through all command-line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    // Use a switch statement for efficient argument matching
    switch (arg) {
      // Reset flag: Start a completely new session, discarding any existing one
      case '--reset':
      case '-r':
        config.reset = true
        break
        
      // Model selection: Specify which Ollama model to use
      // Consumes the next argument as the model name
      case '--model':
      case '-m':
        // Increment i to skip to the value argument
        // If no value provided (args[i+1] is undefined), keep current model
        config.model = args[++i] || config.model
        break
        
      // List models: Query Ollama for available models and display them
      case '--list-models':
      case '-l':
        config.listModels = true
        break
        
      // Data directory: Specify where encrypted session data should be stored
      case '--data-dir':
        config.dataDir = args[++i] || config.dataDir
        break
        
      // Help: Display usage information and exit
      case '--help':
      case '-h':
        console.log(`
ollama-signal-chat - Encrypted TUI chat with Ollama using Signal Protocol

Usage:
  ollama-signal-chat [options]

Options:
  --reset, -r          Start a new encrypted session (clears history)
  --model, -m <name>   Specify the Ollama model to use (default: ${DEFAULT_MODEL})
  --list-models, -l    List available Ollama models
  --data-dir <path>    Directory for encrypted storage (default: ${DEFAULT_DATA_DIR})
  --help, -h           Show this help message

Environment Variables:
  OLLAMA_MODEL         Default model to use
  DATA_DIR             Default data directory

Examples:
  ollama-signal-chat                   # Start chat with default model
  ollama-signal-chat --model qwen2.5   # Use specific model
  ollama-signal-chat --reset           # Start fresh session
  ollama-signal-chat --list-models     # List available models
`)
        process.exit(0)
    }
  }

  return config
}

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================

/**
 * Main application entry point.
 * 
 * This async function serves as the application bootstrap. It:
 * 1. Parses command-line arguments
 * 2. Renders the React/Ink application
 * 3. Waits for the application to exit
 * 4. Handles any fatal errors
 * 
 * The render() function from Ink creates a terminal UI using React components.
 * It returns a promise that resolves when the user exits the application
 * (typically via Ctrl+C or the application's exit handler).
 */
async function main() {
  // Parse configuration from CLI args and environment variables
  const config = parseArgs()

  try {
    // Render the React application to the terminal
    // <App config={config} /> is the root component that manages all UI state
    // waitUntilExit() returns a promise that resolves when the app terminates
    const { waitUntilExit } = render(<App config={config} />)
    await waitUntilExit()
  } catch (error) {
    // Catch and log any unhandled errors before exiting
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

// =============================================================================
// APPLICATION START
// =============================================================================

// Execute the main function to start the application
main()
