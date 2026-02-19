/**
 * Main Chat View Component
 * 
 * This is the primary UI component for the encrypted chat application.
 * It manages the complete chat interface including:
 * - Message display with syntax highlighting
 * - User input handling with cursor support
 * - Message encryption/decryption
 * - Ollama AI integration
 * - Session persistence
 * - Error handling
 * 
 * The component uses a split-pane layout:
 * - Left: Chat messages
 * - Right: Encryption status panel (if terminal is wide enough)
 * - Bottom: Input prompt
 * 
 * Key Features:
 * - End-to-end encryption using Signal Protocol
 * - Real-time message encryption before storage
 * - Non-streaming AI responses (complete before display)
 * - Keyboard navigation (arrows, backspace, enter)
 * - Session reset functionality (Ctrl+R)
 * - Responsive layout based on terminal width
 * 
 * State Management:
 * - Uses React hooks for all state
 * - Separate state for UI (input, loading, errors)
 * - Separate state for data (messages, session)
 * - Refs for stores (stable across renders)
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import type { ChatMessage, EncryptedMessageRecord, SessionData } from '../types'
import { MessageList } from './message-list'
import { StatusBar } from './status-bar'
import { EncryptionStatus } from './encryption-status'
import { encryptMessage, decryptMessage } from '../lib/signal/session'
import { updateSessionMessages } from '../lib/storage'
import { streamChat } from '../lib/ollama'
import type { SignalStores } from '../lib/signal/store'

// =============================================================================
// PROPS INTERFACE
// =============================================================================

/**
 * Props for the ChatView component.
 * 
 * These are passed from the App component after session initialization.
 * All initial data comes from the session restoration/creation process.
 */
interface ChatViewProps {
  /** Complete session data including identities and messages */
  initialSessionData: SessionData
  /** Signal stores for the human user (for encrypting to assistant) */
  initialStores: SignalStores
  /** Signal stores for the AI assistant (for encrypting to user) */
  initialAssistantStores: SignalStores
  /** Directory for saving session updates */
  dataDir: string
  /** Current Ollama model name (from CLI args) */
  model: string
  /** Callback to reset the session (from App component) */
  onReset: () => Promise<void>
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a unique message ID.
 * 
 * Combines current timestamp with a random string to create
 * collision-resistant identifiers for messages.
 * 
 * Format: "{timestamp}-{random}"
 * Example: "1704067200000-abc123def"
 * 
 * @returns string - Unique message identifier
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// =============================================================================
// MAIN CHAT VIEW COMPONENT
// =============================================================================

/**
 * Primary chat interface component.
 * 
 * This component manages the entire chat experience:
 * 1. Displaying message history
 * 2. Handling user input
 * 3. Encrypting messages before storage
 * 4. Querying Ollama for AI responses
 * 5. Decrypting messages for display
 * 
 * @param props - ChatViewProps containing session data and callbacks
 */
export function ChatView({
  initialSessionData,
  initialStores,
  initialAssistantStores,
  dataDir,
  model,
  onReset,
}: ChatViewProps) {
  // ===========================================================================
  // REACT HOOKS SETUP
  // ===========================================================================
  
  // useApp hook from Ink for application lifecycle management
  const { exit } = useApp()
  
  // Session data state - updated when messages are added
  const [sessionData, setSessionData] = useState(initialSessionData)
  
  // Store refs - these are stable and don't change during component lifecycle
  // We use useState instead of useRef to satisfy TypeScript, but they're never updated
  const [userStores] = useState(initialStores)
  const [assistantStores] = useState(initialAssistantStores)
  
  // Messages state - array of decrypted ChatMessage objects for display
  const [messages, setMessages] = useState<ChatMessage[]>([])
  
  // Loading state - true when waiting for Ollama response
  const [isLoading, setIsLoading] = useState(false)
  
  // Error state - displays error banners when set
  const [error, setError] = useState<string | null>(null)
  
  // Reset confirmation state - shows confirmation prompt when true
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  
  // Input state - current text in the input field
  const [input, setInput] = useState('')

  // ===========================================================================
  // MESSAGE LOADING (ON MOUNT)
  // ===========================================================================
  
  /**
   * Effect: Load and decrypt existing messages on component mount.
   * 
   * When the chat view first loads, this effect:
   * 1. Iterates through all encrypted messages in the session
   * 2. Decrypts each message using the Signal Protocol
   * 3. Handles decryption errors (session corruption detection)
   * 4. Updates the messages state with decrypted content
   * 
   * Error Handling:
   * - Tracks failed decryptions
   * - If ALL messages fail, assumes session is corrupted
   * - Clears corrupted session and shows error message
   * - This allows recovery from incompatible session formats
   */
  useEffect(() => {
    const loadMessages = async () => {
      const decrypted: ChatMessage[] = []
      let failedCount = 0
      
      // Iterate through all encrypted messages in session
      for (const record of sessionData.messages) {
        try {
          // Determine which stores to use based on sender
          // If user sent message, use assistant's stores to decrypt
          // If assistant sent message, use user's stores to decrypt
          const stores = record.sender === 'user' ? assistantStores : userStores
          const senderName = record.sender === 'user' ? 'user' : 'assistant'

          // Decrypt the message using Signal Protocol
          const plaintext = await decryptMessage(
            Buffer.from(record.ciphertext, 'base64'),
            record.messageType,
            senderName,
            stores
          )
          
          // Add decrypted message to display array
          decrypted.push({
            id: record.id,
            role: record.sender,
            content: plaintext,
            timestamp: record.timestamp,
          })
        } catch (err) {
          // Track decryption failures
          failedCount++
          console.error('Failed to decrypt message:', err)
        }
      }
      
      // Check for session corruption: all messages failed but messages exist
      if (failedCount > 0 && decrypted.length === 0 && sessionData.messages.length > 0) {
        console.error('Session appears corrupted, clearing message history')
        
        // Create updated session data with cleared messages
        const updatedSessionData = {
          ...sessionData,
          model: model, // Update to current model from props
          messages: [], // Clear all messages
        }
        
        // Update state and save to disk
        setSessionData(updatedSessionData)
        await updateSessionMessages(dataDir, updatedSessionData, userStores)
        setError('Session corrupted. Message history cleared. Starting fresh.')
      }
      
      // Update messages state with successfully decrypted messages
      setMessages(decrypted)
    }
    
    // Execute message loading
    loadMessages()
  }, []) // Empty deps = run once on mount

  // ===========================================================================
  // KEYBOARD HANDLING - RESET & CONFIRMATION
  // ===========================================================================
  
  /**
   * Handler: Ctrl+R for session reset, Escape to cancel.
   * 
   * This useInput hook handles global keyboard shortcuts:
   * - Ctrl+R: Toggle reset confirmation / Execute reset
   * - Escape: Cancel reset confirmation
   * 
   * The reset requires two presses of Ctrl+R to prevent accidental resets.
   * First press shows confirmation, second press executes.
   */
  useInput(async (inputChar, key) => {
    // Check for Ctrl+R (reset shortcut)
    if (key.ctrl && inputChar === 'r') {
      if (showResetConfirm) {
        // Second Ctrl+R - execute reset
        setShowResetConfirm(false)
        await onReset()
      } else {
        // First Ctrl+R - show confirmation
        setShowResetConfirm(true)
      }
    } else if (key.escape && showResetConfirm) {
      // Escape cancels the reset confirmation
      setShowResetConfirm(false)
    }
  })

  // ===========================================================================
  // MESSAGE SUBMISSION HANDLER
  // ===========================================================================
  
  /**
   * Handler: Submit user message and get AI response.
   * 
   * This callback handles the complete message flow:
   * 1. Validate input (not empty, not already loading)
   * 2. Encrypt user message using Signal Protocol
   * 3. Add encrypted message to session storage
   * 4. Send message history to Ollama
   * 5. Collect complete AI response (no streaming)
   * 6. Encrypt AI response
   * 7. Add both messages to state and storage
   * 8. Update session file on disk
   * 
   * Uses useCallback for performance optimization.
   */
  const handleSubmit = useCallback(async () => {
    // Validation: Don't submit if loading or empty input
    if (isLoading || !input.trim()) return

    const userInput = input.trim()
    setInput('')          // Clear input field
    setIsLoading(true)    // Show loading state
    setError(null)        // Clear any previous errors

    // Generate unique IDs and timestamps for both messages
    const userMessageId = generateId()
    const userTimestamp = Date.now()

    try {
      // -----------------------------------------------------------------------
      // STEP 1: Encrypt user message
      // -----------------------------------------------------------------------
      const encrypted = await encryptMessage(userInput, 'assistant', userStores)

      // Create encrypted record for storage
      const userRecord: EncryptedMessageRecord = {
        id: userMessageId,
        sender: 'user',
        ciphertext: Buffer.from(encrypted.ciphertext).toString('base64'),
        messageType: encrypted.messageType,
        timestamp: userTimestamp,
      }

      // Create display message
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: userInput,
        timestamp: userTimestamp,
      }

      // Add user message to display immediately
      setMessages((prev) => [...prev, userMessage])

      // -----------------------------------------------------------------------
      // STEP 2: Get AI response from Ollama
      // -----------------------------------------------------------------------
      // Build context: all previous messages + new user message
      const contextMessages = [...messages, userMessage]

      // Collect complete response (no streaming for TUI stability)
      let assistantContent = ''
      for await (const chunk of streamChat(
        { model: sessionData.model },
        contextMessages
      )) {
        assistantContent += chunk
      }

      // -----------------------------------------------------------------------
      // STEP 3: Encrypt AI response
      // -----------------------------------------------------------------------
      const assistantEncrypted = await encryptMessage(
        assistantContent,
        'user',
        assistantStores
      )

      // Generate IDs for assistant message
      const assistantMessageId = generateId()
      const assistantRecord: EncryptedMessageRecord = {
        id: assistantMessageId,
        sender: 'assistant',
        ciphertext: Buffer.from(assistantEncrypted.ciphertext).toString('base64'),
        messageType: assistantEncrypted.messageType,
        timestamp: Date.now(),
      }

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      }

      // Add assistant message to display
      setMessages((prev) => [...prev, assistantMessage])

      // -----------------------------------------------------------------------
      // STEP 4: Persist to storage
      // -----------------------------------------------------------------------
      const updatedSessionData = {
        ...sessionData,
        messages: [...sessionData.messages, userRecord, assistantRecord],
      }
      setSessionData(updatedSessionData)
      await updateSessionMessages(dataDir, updatedSessionData, userStores)
      
    } catch (err) {
      // Handle any errors during the process
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      // Always clear loading state, even on error
      setIsLoading(false)
    }
  }, [isLoading, input, messages, sessionData, userStores, assistantStores, dataDir])

  // ===========================================================================
  // KEYBOARD HANDLING - TEXT INPUT WITH CURSOR
  // ===========================================================================
  
  /**
   * Cursor position state for text input.
   * Tracks where the cursor is within the input string.
   */
  const [cursorPos, setCursorPos] = useState(0)
  
  /**
   * Handler: Character input, cursor movement, and editing.
   * 
   * This useInput hook handles all text input operations:
   * - Enter: Submit message
   * - Backspace: Delete character before cursor
   * - Left/Right Arrows: Move cursor
   * - Regular characters: Insert at cursor position
   * 
   * The cursor-based editing allows mid-line insertions and deletions,
   * similar to standard terminal input.
   */
  useInput((inputChar, key) => {
    // Ignore input while loading
    if (isLoading) return
    
    // Ignore control/meta key combinations (handled by other hooks)
    if (key.ctrl || key.meta) return
    
    if (key.return) {
      // Enter key: Submit the message
      handleSubmit()
      setCursorPos(0)  // Reset cursor to beginning
    } else if (key.delete || key.backspace) {
      // Backspace: Delete character before cursor
      if (cursorPos > 0) {
        // Remove character at cursorPos-1
        setInput((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos))
        setCursorPos((prev) => prev - 1)  // Move cursor left
      }
    } else if (key.leftArrow) {
      // Left arrow: Move cursor left (but not past start)
      setCursorPos((prev) => Math.max(0, prev - 1))
    } else if (key.rightArrow) {
      // Right arrow: Move cursor right (but not past end)
      setCursorPos((prev) => Math.min(input.length, prev + 1))
    } else if (inputChar && !key.ctrl && !key.meta) {
      // Regular character: Insert at cursor position
      setInput((prev) => prev.slice(0, cursorPos) + inputChar + prev.slice(cursorPos))
      setCursorPos((prev) => prev + 1)  // Move cursor right
    }
  })

  // ===========================================================================
  // DERIVED STATE
  // ===========================================================================
  
  /**
   * Memoized props for StatusBar component.
   * 
   * Prevents unnecessary re-renders by only recalculating when
   * dependencies change.
   */
  const statusBarProps = useMemo(() => ({
    model: sessionData.model,
    messageCount: messages.length,
    sessionAge: sessionData.created,
  }), [sessionData.model, messages.length, sessionData.created])

  // ===========================================================================
  // LAYOUT CALCULATIONS
  // ===========================================================================
  
  /**
   * Responsive layout calculations based on terminal width.
   * 
   * If terminal is wide enough (≥110 columns), show the encryption status
   * panel on the right. Otherwise, hide it to maximize chat space.
   */
  const { stdout } = useStdout()
  const terminalWidth = stdout.columns || 80
  const showEncryptionPanel = terminalWidth >= 110
  const sidebarWidth = showEncryptionPanel ? 37 : 0
  const chatWidth = terminalWidth - sidebarWidth - 2

  // ===========================================================================
  // RENDER
  // ===========================================================================
  
  return (
    <Box flexDirection="column" height="100%">
      {/* Top status bar with model info and controls */}
      <StatusBar {...statusBarProps} />
      
      {/* Error banner (shown only when error state is set) */}
      {error && (
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      
      {/* Reset confirmation banner (shown only when reset is initiated) */}
      {showResetConfirm && (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">
            Press Ctrl+R again to confirm reset (this will clear all history), or
            Escape to cancel
          </Text>
        </Box>
      )}
      
      {/* Main content area: Chat messages + optional sidebar */}
      <Box flexGrow={1} flexDirection="row">
        {/* Chat messages area */}
        <Box width={chatWidth} flexDirection="column">
          <MessageList messages={messages} maxWidth={chatWidth} />
        </Box>
        
        {/* Encryption status panel (conditional based on terminal width) */}
        {showEncryptionPanel && (
          <Box width={sidebarWidth} flexDirection="column" marginLeft={1}>
            <EncryptionStatus 
              sessionData={sessionData}
              messageCount={messages.length}
            />
          </Box>
        )}
      </Box>
      
      {/* Bottom input prompt with cursor */}
      <Box>
        {isLoading ? (
          // Show "Thinking..." while waiting for AI
          <Text color="gray">Thinking...</Text>
        ) : (
          // Show input prompt with cursor
          <Box>
            <Text bold color="cyan">{'>>> '}</Text>
            <Text>{input.slice(0, cursorPos)}</Text>
            <Text backgroundColor="white" color="black">{input[cursorPos] || ' '}</Text>
            <Text>{input.slice(cursorPos + 1)}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
