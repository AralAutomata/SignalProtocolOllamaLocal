/**
 * Application Root Component
 * 
 * The App component serves as the root of the React component tree.
 * It manages the application's high-level state including session initialization,
 * model selection, and routing between different app views (loading, error, chat, etc.).
 * 
 * This component is responsible for:
 * - Initializing or restoring Signal Protocol encryption sessions
 * - Handling the --list-models CLI flag
 * - Managing session reset functionality
 * - Error boundary and display
 * - Passing configuration down to the ChatView component
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp } from 'ink'
import { ChatView } from './components/chat-view'
import {
  createNewSession,
  restoreSession,
  resetSession,
} from './lib/storage'
import { listModels } from './lib/ollama'
import type { SessionData, AppConfig } from './types'

// =============================================================================
// PROPS INTERFACE
// =============================================================================

/**
 * Props for the App component.
 * @property config - Parsed application configuration from CLI args and environment
 */
interface AppProps {
  config: AppConfig
}

// =============================================================================
// APPLICATION STATE MANAGEMENT
// =============================================================================

/**
 * Union type representing all possible application states.
 * 
 * Using a discriminated union (with status discriminator) provides:
 * - Type safety: TypeScript knows which fields are available in each state
 * - Exhaustiveness checking: Compiler ensures all states are handled in render
 * - Clear state transitions: Only valid state transitions are possible
 */
type AppState =
  // Initial loading state while setting up encryption
  | { status: 'loading' }
  
  // Ready state with all session data loaded
  | { status: 'ready'; sessionData: SessionData; userStores: any; assistantStores: any }
  
  // Error state with error message for display
  | { status: 'error'; message: string }
  
  // Listing available Ollama models (from --list-models flag)
  | { status: 'listing-models'; models: string[] }

// =============================================================================
// MAIN APPLICATION COMPONENT
// =============================================================================

/**
 * Root application component that manages session lifecycle.
 * 
 * This component implements the following flow:
 * 1. Mount -> useEffect triggers initialization
 * 2. Check CLI flags (--list-models, --reset)
 * 3. Try to restore existing session or create new one
 * 4. Render appropriate view based on state
 * 
 * @param config - Application configuration from CLI arguments
 */
export function App({ config }: AppProps) {
  // useApp hook from Ink provides access to the terminal application context
  // exit() function can be called to gracefully exit the application
  const { exit } = useApp()
  
  // State management using React useState hook
  // Start in 'loading' state while initializing encryption
  const [state, setState] = useState<AppState>({ status: 'loading' })

  // ===========================================================================
  // SESSION INITIALIZATION
  // ===========================================================================
  
  /**
   * Effect hook that runs once on component mount to initialize the session.
   * 
   * This effect handles the session initialization logic:
   * 1. If --list-models flag is set, fetch and display available models
   * 2. If --reset flag is set, create a completely new session
   * 3. Otherwise, try to restore existing session
   * 4. If model changed or session doesn't exist, create new session
   * 
   * The empty dependency array [] means this effect runs only once on mount.
   * The config object is actually stable (from parseArgs), so it's safe to include.
   */
  useEffect(() => {
    // Async IIFE (Immediately Invoked Function Expression) to handle async operations
    async function init() {
      try {
        // Check if user requested to list available models
        if (config.listModels) {
          // Query Ollama for available models
          const models = await listModels({ model: config.model })
          // Transition to listing-models state to display the results
          setState({ status: 'listing-models', models })
          return
        }

        // Check if user requested a fresh session (clear all history)
        if (config.reset) {
          // Create new Signal Protocol session with fresh keys
          const { sessionData, userStores, assistantStores } = await createNewSession(
            config.dataDir,
            config.model
          )
          // Transition to ready state with new session
          setState({ status: 'ready', sessionData, userStores, assistantStores })
          return
        }

        // Attempt to restore existing session from disk
        const existing = await restoreSession(config.dataDir)
        
        // Check if session exists and uses the same model
        if (existing && existing.sessionData.model === config.model) {
          // Session restored successfully with matching model
          setState({
            status: 'ready',
            sessionData: existing.sessionData,
            userStores: existing.userStores,
            assistantStores: existing.assistantStores,
          })
        } else {
          // No session found or model changed - create new session
          if (existing && existing.sessionData.model !== config.model) {
            console.log(`Model changed from ${existing.sessionData.model} to ${config.model}, creating new session`)
          }
          // Generate new encryption keys and session
          const { sessionData, userStores, assistantStores } = await createNewSession(
            config.dataDir,
            config.model
          )
          setState({ status: 'ready', sessionData, userStores, assistantStores })
        }
      } catch (err) {
        // Handle any initialization errors
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }
    
    // Execute the initialization function
    init()
  }, [config])

  // ===========================================================================
  // SESSION RESET HANDLER
  // ===========================================================================
  
  /**
   * Callback function to handle session reset requests from child components.
   * 
   * This is passed to ChatView via props and is triggered when the user presses
   * Ctrl+R to reset their session. It:
   * 1. Sets loading state to show feedback
   * 2. Calls resetSession to generate new encryption keys
   * 3. Updates state with new session data
   * 4. Handles any errors during reset
   * 
   * useCallback memoizes the function to prevent unnecessary re-renders.
   * Dependencies ensure the function updates if config changes.
   */
  const handleReset = useCallback(async () => {
    // Show loading state while resetting
    setState({ status: 'loading' })
    try {
      // Generate completely new Signal Protocol keys and session
      const { sessionData, userStores, assistantStores } = await resetSession(
        config.dataDir,
        config.model
      )
      // Transition back to ready state with fresh session
      setState({ status: 'ready', sessionData, userStores, assistantStores })
    } catch (err) {
      // Handle reset errors
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to reset session',
      })
    }
  }, [config.dataDir, config.model])

  // ===========================================================================
  // RENDER LOGIC - STATE-BASED RENDERING
  // ===========================================================================

  // State: Loading - Show initialization spinner/message
  if (state.status === 'loading') {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center">
        <Text color="cyan">Initializing encrypted session...</Text>
      </Box>
    )
  }

  // State: Error - Display error message
  if (state.status === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Error:
        </Text>
        <Text color="red">{state.message}</Text>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    )
  }

  // State: Listing Models - Display available Ollama models
  if (state.status === 'listing-models') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Available Ollama Models:
        </Text>
        {state.models.length === 0 ? (
          <Text color="gray">No models found. Pull a model with: ollama pull &lt;model&gt;</Text>
        ) : (
          state.models.map((model) => <Text key={model}>  • {model}</Text>)
        )}
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    )
  }

  // State: Ready - Render main chat interface
  // This is the default/primary state where the user can chat
  return (
    <ChatView
      initialSessionData={state.sessionData}
      initialStores={state.userStores}
      initialAssistantStores={state.assistantStores}
      dataDir={config.dataDir}
      model={config.model}
      onReset={handleReset}
    />
  )
}
