/**
 * Core Type Definitions
 * 
 * This module defines the TypeScript interfaces and types used throughout
 * the Ollama Signal Chat application. These types provide:
 * - Type safety across the codebase
 * - Clear contracts between components
 * - Documentation of data structures
 * 
 * The types are organized into three categories:
 * 1. Chat message types (user-facing)
 * 2. Session management types (encryption/storage)
 * 3. Application configuration types
 */

// =============================================================================
// EXTERNAL TYPE IMPORTS
// =============================================================================
// Import types from other modules that we need for our interfaces

import type { SerializedIdentityBundle } from './lib/signal/types'
import type { SerializedStores } from './lib/signal/store'
import type { CiphertextMessageType } from '@signalapp/libsignal-client'

// =============================================================================
// CHAT MESSAGE TYPES
// =============================================================================

/**
 * Represents a decrypted chat message displayed to the user.
 * 
 * This is the user-facing representation of a message after it has been
 * decrypted from its encrypted storage format. The content is plaintext
 * and ready for display in the UI.
 * 
 * @example
 * {
 *   id: '1234567890-abc123',
 *   role: 'user',
 *   content: 'Hello, how are you?',
 *   timestamp: 1704067200000
 * }
 */
export interface ChatMessage {
  /** Unique identifier for the message (timestamp + random string) */
  id: string
  
  /** Role indicates who sent the message - user or AI assistant */
  role: 'user' | 'assistant'
  
  /** The plaintext content of the message */
  content: string
  
  /** Unix timestamp (milliseconds) when the message was created */
  timestamp: number
}

// =============================================================================
// ENCRYPTION STORAGE TYPES
// =============================================================================

/**
 * Represents an encrypted message as stored on disk.
 * 
 * This is the storage format for messages. Unlike ChatMessage which contains
 * plaintext, this stores the encrypted ciphertext using the Signal Protocol.
 * The ciphertext is base64-encoded for JSON serialization.
 * 
 * The messageType indicates whether this was encrypted using the initial
 * X3DH handshake (PreKey) or the Double Ratchet (SignalMessage).
 * 
 * @example
 * {
 *   id: '1234567890-abc123',
 *   sender: 'user',
 *   ciphertext: 'base64EncodedEncryptedData...',
 *   messageType: 2, // CiphertextMessageType.SignalMessage
 *   timestamp: 1704067200000
 * }
 */
export interface EncryptedMessageRecord {
  /** Unique identifier matching the ChatMessage id */
  id: string
  
  /** Who sent this encrypted message */
  sender: 'user' | 'assistant'
  
  /** Base64-encoded encrypted message content */
  ciphertext: string
  
  /** 
   * Signal Protocol message type
   * - PreKey (1): Initial X3DH handshake message
   * - SignalMessage (2): Regular Double Ratchet message
   */
  messageType: CiphertextMessageType
  
  /** Unix timestamp when the message was created */
  timestamp: number
}

// =============================================================================
// SESSION DATA TYPES
// =============================================================================

/**
 * Complete session state persisted to disk.
 * 
 * This interface defines the structure of the session.json file that stores
 * all encrypted session data between application runs. It contains:
 * - Version info for migration compatibility
 * - Creation timestamp and model name
 * - Both user and assistant identity key pairs (Signal Protocol)
 * - Both user and assistant session stores (Double Ratchet state)
 * - Array of encrypted messages
 * 
 * The session data is encrypted at rest using the Signal Protocol's
 * encryption. The identity key pairs are the cryptographic roots of trust
 * for the entire session.
 * 
 * @security
 * This data contains sensitive cryptographic material. The file should
 * have restrictive permissions (0600) and be stored in a secure location.
 */
export interface SessionData {
  /** 
   * Version number for session format compatibility
   * Increment when making breaking changes to the format
   */
  version: 1
  
  /** Unix timestamp when this session was first created */
  created: number
  
  /** 
   * Name of the Ollama model used for this session
   * Used to detect model changes (requires new session)
   */
  model: string
  
  /** 
   * User's identity key bundle
   * Contains long-term identity key, signed pre-keys, and one-time pre-keys
   * This is the user's cryptographic identity in the Signal Protocol
   */
  userIdentity: SerializedIdentityBundle
  
  /** 
   * Assistant's identity key bundle
   * Separate identity for the AI assistant
   * Enables bidirectional encryption (user encrypts to assistant, vice versa)
   */
  assistantIdentity: SerializedIdentityBundle
  
  /** 
   * User's session stores
   * Contains the Double Ratchet state for encrypting/decrypting messages
   * Includes session state, identity keys, pre-keys, and Kyber post-quantum keys
   */
  userStores: SerializedStores
  
  /** 
   * Assistant's session stores
   * Separate ratchet state for the assistant's side of the conversation
   */
  assistantStores: SerializedStores
  
  /** Array of all encrypted messages in this session */
  messages: EncryptedMessageRecord[]
}

// =============================================================================
// APPLICATION CONFIGURATION TYPES
// =============================================================================

/**
 * Application configuration parsed from CLI arguments and environment.
 * 
 * This configuration is determined at startup by:
 * 1. Checking command-line arguments
 * 2. Falling back to environment variables
 * 3. Using hardcoded defaults
 * 
 * The configuration is immutable after parsing and passed down through
 * the component tree via props.
 * 
 * @example
 * {
 *   model: 'llama3.2',
 *   dataDir: '/app/data',
 *   reset: false,
 *   listModels: false
 * }
 */
export interface AppConfig {
  /** 
   * Ollama model name to use for chat responses
   * Can be specified via --model CLI flag or OLLAMA_MODEL env var
   */
  model: string
  
  /** 
   * Directory path for encrypted session storage
   * Can be specified via --data-dir CLI flag or DATA_DIR env var
   * Default: '/app/data' (in Docker container)
   */
  dataDir: string
  
  /** 
   * If true, discard any existing session and create a new one
   * Set via --reset or -r CLI flag
   * Useful for starting fresh or if session is corrupted
   */
  reset: boolean
  
  /** 
   * If true, query Ollama for available models and display them
   * Set via --list-models or -l CLI flag
   * Exits after displaying the list
   */
  listModels: boolean
}
