/**
 * Session Persistence and Storage Management
 * 
 * This module handles all aspects of saving and loading encrypted chat sessions.
 * It provides a bridge between the in-memory Signal Protocol stores and persistent
 * storage on disk.
 * 
 * Key Responsibilities:
 * 1. Creating new sessions with fresh cryptographic identities
 * 2. Saving session state to disk (JSON files)
 * 3. Restoring sessions from disk
 * 4. Handling session corruption and errors
 * 5. Managing the session file format and versioning
 * 
 * Session File Format:
 * - Stored as JSON for human readability (though content is base64-encoded)
 * - Contains: identities, stores, messages, metadata
 * - Located at: {dataDir}/session.json
 * - Should have restrictive file permissions (not implemented here)
 * 
 * Two-Party Architecture:
 * Unlike typical Signal usage where each user has one identity and communicates
 * with many others, we create TWO complete identities:
 * - userIdentity: Represents the human user
 * - assistantIdentity: Represents the AI assistant
 * This allows bidirectional encryption in a two-party chat.
 */

// =============================================================================
// EXTERNAL IMPORTS
// =============================================================================

import * as fs from 'fs'    // Node.js file system module for I/O
import * as path from 'path'  // Node.js path utilities for cross-platform paths
import { PrivateKey } from '@signalapp/libsignal-client'  // Signal private key type
import type { SessionData } from '../types'  // Session data type definition

// Signal Protocol functions
import {
  createIdentityBundle,        // Generate new Signal identity
  serializeIdentityBundle,     // Convert identity to JSON format
  deserializeIdentityBundle,   // Restore identity from JSON
  populateStores,              // Fill stores with identity keys
} from './signal/identities'

// Signal Protocol store classes
import {
  InMemorySessionStore,        // Stores Double Ratchet session state
  InMemoryIdentityKeyStore,    // Stores identity public keys
  InMemoryPreKeyStore,         // Stores one-time pre-keys
  InMemorySignedPreKeyStore,   // Stores signed pre-keys
  InMemoryKyberPreKeyStore,    // Stores post-quantum pre-keys
  type SignalStores,           // Type: collection of all stores
  type SerializedStores,       // Type: JSON-serializable stores
} from './signal/store'

import { establishSession } from './signal/session'  // X3DH session establishment

// =============================================================================
// CONSTANTS
// =============================================================================

/** Filename for session storage */
const SESSION_FILE = 'session.json'

/** Default Ollama model to use when creating new sessions */
const DEFAULT_MODEL = 'llama3.2'

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Context object containing all session data and stores.
 * 
 * This is returned after creating or restoring a session. It contains
 * everything needed to participate in encrypted messaging:
 * - Serialized session data (for saving)
 * - Live store objects (for encryption/decryption operations)
 * 
 * Both user and assistant stores are provided for bidirectional encryption.
 */
export interface SessionContext {
  /** Serialized session data that can be saved to disk */
  sessionData: SessionData
  /** Signal stores for the human user */
  userStores: SignalStores
  /** Signal stores for the AI assistant */
  assistantStores: SignalStores
}

// =============================================================================
// SESSION FILE I/O
// =============================================================================

/**
 * Load session data from disk.
 * 
 * Reads the session.json file from the specified data directory and parses
 * it into a SessionData object. Returns null if no session file exists.
 * 
 * This is the entry point for session restoration on application startup.
 * 
 * @param dataDir - Directory containing the session.json file
 * @returns Promise<SessionData | null> - Parsed session data, or null if not found
 * 
 * @example
 * const session = await loadSession('/app/data')
 * if (session) {
 *   console.log(`Restoring session from ${new Date(session.created)}`)
 * }
 */
export async function loadSession(dataDir: string): Promise<SessionData | null> {
  // Construct full path to session file
  const sessionPath = path.join(dataDir, SESSION_FILE)
  
  // Check if session file exists
  if (!fs.existsSync(sessionPath)) {
    return null  // No existing session
  }
  
  // Read file contents as UTF-8 string
  const data = fs.readFileSync(sessionPath, 'utf-8')
  
  // Parse JSON into SessionData object
  return JSON.parse(data)
}

/**
 * Save session data to disk.
 * 
 * Writes the session data to a JSON file in the specified directory.
 * Creates the directory if it doesn't exist. Pretty-prints JSON with
 * 2-space indentation for readability.
 * 
 * @param dataDir - Directory to save the session file
 * @param data - SessionData object to serialize and save
 * @returns Promise<void> - Completes when file is written
 * 
 * @example
 * await saveSession('/app/data', sessionData)
 * // Creates /app/data/session.json
 */
export async function saveSession(
  dataDir: string,
  data: SessionData
): Promise<void> {
  // Construct full path
  const sessionPath = path.join(dataDir, SESSION_FILE)
  
  // Create directory structure if it doesn't exist (recursive)
  fs.mkdirSync(dataDir, { recursive: true })
  
  // Serialize to JSON with pretty printing (2-space indent)
  // This makes the file human-readable for debugging
  fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2))
}

// =============================================================================
// STORE CONTEXT CREATION (Helper)
// =============================================================================

/**
 * Create a SignalStores context from an identity key.
 * 
 * This helper function initializes all five Signal Protocol stores with
 * a given identity. It's used during session restoration.
 * 
 * @param identityKey - The identity private key
 * @param registrationId - The registration ID for this identity
 * @returns Promise<SignalStores> - Initialized stores ready for use
 */
async function createStoreContext(
  identityKey: PrivateKey,
  registrationId: number
): Promise<SignalStores> {
  // Deserialize the identity key store from the identity key
  // We start with empty identityKeys map (no remote identities yet)
  const identity = await InMemoryIdentityKeyStore.deserialize({
    identityKey: Buffer.from(identityKey.serialize()).toString('base64'),
    registrationId,
    identityKeys: {},
  })

  // Create and return all five stores
  return {
    session: new InMemorySessionStore(),      // Empty session store
    identity,                                 // Identity store with our key
    preKey: new InMemoryPreKeyStore(),        // Empty pre-key store
    signedPreKey: new InMemorySignedPreKeyStore(),  // Empty signed pre-key store
    kyberPreKey: new InMemoryKyberPreKeyStore(),    // Empty Kyber store
  }
}

// =============================================================================
// STORE SERIALIZATION
// =============================================================================

/**
 * Serialize all Signal stores to JSON-compatible format.
 * 
 * Converts the in-memory store objects (containing cryptographic objects)
 * into a format suitable for JSON serialization by calling each store's
 * serialize() method.
 * 
 * @param stores - SignalStores object to serialize
 * @returns SerializedStores - JSON-serializable representation
 */
function serializeStores(stores: SignalStores): SerializedStores {
  return {
    session: stores.session.serialize(),
    identity: stores.identity.serialize(),
    preKey: stores.preKey.serialize(),
    signedPreKey: stores.signedPreKey.serialize(),
    kyberPreKey: stores.kyberPreKey.serialize(),
  }
}

/**
 * Deserialize and restore Signal stores from JSON data.
 * 
 * Populates the in-memory stores with data from a serialized representation.
 * Each store's deserialize() method is called to restore its state.
 * 
 * @param data - SerializedStores object from JSON
 * @param stores - SignalStores object to populate
 */
function deserializeStores(data: SerializedStores, stores: SignalStores): void {
  stores.session.deserialize(data.session)
  stores.identity.deserialize(data.identity)
  stores.preKey.deserialize(data.preKey)
  stores.signedPreKey.deserialize(data.signedPreKey)
  stores.kyberPreKey.deserialize(data.kyberPreKey)
}

// =============================================================================
// SESSION CREATION
// =============================================================================

/**
 * Create a completely new encrypted session.
 * 
 * This is the primary function for initializing a fresh chat session. It:
 * 1. Generates new cryptographic identities for both user and assistant
 * 2. Creates Signal stores for both parties
 * 3. Populates stores with identity keys
 * 4. Establishes bidirectional encrypted sessions (X3DH)
 * 5. Saves the complete session to disk
 * 
 * The result is a ready-to-use encrypted chat session with fresh keys.
 * 
 * @param dataDir - Directory for saving session file
 * @param model - Ollama model name to associate with this session
 * @returns Promise<SessionContext> - Complete session context with stores
 * 
 * @example
 * const { sessionData, userStores, assistantStores } = await createNewSession('/app/data', 'llama3.2')
 * // Ready to send/receive encrypted messages
 */
export async function createNewSession(
  dataDir: string,
  model: string = DEFAULT_MODEL
): Promise<SessionContext> {
  // -------------------------------------------------------------------------
  // STEP 1: Generate new identities for both parties
  // -------------------------------------------------------------------------
  const userIdentity = await createIdentityBundle()
  const assistantIdentity = await createIdentityBundle()

  // -------------------------------------------------------------------------
  // STEP 2: Create store sets for both parties
  // -------------------------------------------------------------------------
  // Each party gets their own set of five stores
  const userStores: SignalStores = {
    session: new InMemorySessionStore(),
    identity: new InMemoryIdentityKeyStore(
      userIdentity.identityKeyPair.privateKey,
      userIdentity.registrationId
    ),
    preKey: new InMemoryPreKeyStore(),
    signedPreKey: new InMemorySignedPreKeyStore(),
    kyberPreKey: new InMemoryKyberPreKeyStore(),
  }

  const assistantStores: SignalStores = {
    session: new InMemorySessionStore(),
    identity: new InMemoryIdentityKeyStore(
      assistantIdentity.identityKeyPair.privateKey,
      assistantIdentity.registrationId
    ),
    preKey: new InMemoryPreKeyStore(),
    signedPreKey: new InMemorySignedPreKeyStore(),
    kyberPreKey: new InMemoryKyberPreKeyStore(),
  }

  // -------------------------------------------------------------------------
  // STEP 3: Populate stores with pre-keys
  // -------------------------------------------------------------------------
  // Transfer pre-keys from identity bundles into stores
  await populateStores(userIdentity, userStores)
  await populateStores(assistantIdentity, assistantStores)

  // -------------------------------------------------------------------------
  // STEP 4: Establish bidirectional encrypted sessions
  // -------------------------------------------------------------------------
  // Perform X3DH key agreement in both directions
  await establishSession(userIdentity, assistantIdentity, userStores, assistantStores)

  // -------------------------------------------------------------------------
  // STEP 5: Create session data structure
  // -------------------------------------------------------------------------
  const sessionData: SessionData = {
    version: 1,                                    // Session format version
    created: Date.now(),                           // Creation timestamp
    model,                                          // Associated Ollama model
    userIdentity: serializeIdentityBundle(userIdentity),     // Serialized user identity
    assistantIdentity: serializeIdentityBundle(assistantIdentity),  // Serialized assistant identity
    userStores: serializeStores(userStores),       // Serialized user stores
    assistantStores: serializeStores(assistantStores),  // Serialized assistant stores
    messages: [],                                  // Empty message history (new session)
  }

  // -------------------------------------------------------------------------
  // STEP 6: Save to disk
  // -------------------------------------------------------------------------
  await saveSession(dataDir, sessionData)

  // Return complete context
  return { sessionData, userStores, assistantStores }
}

// =============================================================================
// SESSION RESTORATION
// =============================================================================

/**
 * Restore an existing session from disk.
 * 
 * Loads session data from the session.json file and reconstructs the
 * in-memory stores. This allows resuming a previous chat session with
 * all message history and encryption state intact.
 * 
 * Error Handling:
 * - Returns null if no session file exists
 * - Returns null if session data is corrupted (deserialization fails)
 * - Logs errors but doesn't throw (graceful degradation)
 * 
 * @param dataDir - Directory containing session.json
 * @returns Promise<SessionContext | null> - Restored session, or null if not available
 * 
 * @example
 * const session = await restoreSession('/app/data')
 * if (!session) {
 *   // No existing session, need to create new one
 *   return await createNewSession('/app/data', 'llama3.2')
 * }
 */
export async function restoreSession(
  dataDir: string
): Promise<SessionContext | null> {
  // -------------------------------------------------------------------------
  // STEP 1: Load session data from disk
  // -------------------------------------------------------------------------
  const sessionData = await loadSession(dataDir)
  if (!sessionData) return null  // No session file found

  // -------------------------------------------------------------------------
  // STEP 2: Deserialize identity bundles
  // -------------------------------------------------------------------------
  const userIdentity = deserializeIdentityBundle(sessionData.userIdentity)
  const assistantIdentity = deserializeIdentityBundle(sessionData.assistantIdentity)

  // -------------------------------------------------------------------------
  // STEP 3: Create store sets with restored identities
  // -------------------------------------------------------------------------
  const userStores: SignalStores = {
    session: new InMemorySessionStore(),
    identity: new InMemoryIdentityKeyStore(
      userIdentity.identityKeyPair.privateKey,
      userIdentity.registrationId
    ),
    preKey: new InMemoryPreKeyStore(),
    signedPreKey: new InMemorySignedPreKeyStore(),
    kyberPreKey: new InMemoryKyberPreKeyStore(),
  }

  const assistantStores: SignalStores = {
    session: new InMemorySessionStore(),
    identity: new InMemoryIdentityKeyStore(
      assistantIdentity.identityKeyPair.privateKey,
      assistantIdentity.registrationId
    ),
    preKey: new InMemoryPreKeyStore(),
    signedPreKey: new InMemorySignedPreKeyStore(),
    kyberPreKey: new InMemoryKyberPreKeyStore(),
  }

  // -------------------------------------------------------------------------
  // STEP 4: Restore store state from serialized data
  // -------------------------------------------------------------------------
  try {
    deserializeStores(sessionData.userStores, userStores)
    deserializeStores(sessionData.assistantStores, assistantStores)
  } catch (err) {
    // If deserialization fails, session is corrupted
    console.error('Failed to restore session stores, creating new session:', err)
    return null  // Signal to create new session
  }

  // Return restored context
  return { sessionData, userStores, assistantStores }
}

// =============================================================================
// SESSION UPDATE
// =============================================================================

/**
 * Update session with new messages and store state.
 * 
 * After sending/receiving messages, this function saves the updated:
 * - Message history (new encrypted messages)
 * - Store state (updated Double Ratchet state)
 * 
 * This ensures no messages are lost and encryption state is preserved.
 * 
 * @param dataDir - Directory containing session.json
 * @param sessionData - Updated session data with new messages
 * @param stores - Current store state (with updated ratchet)
 * @returns Promise<void> - Completes when saved
 */
export async function updateSessionMessages(
  dataDir: string,
  sessionData: SessionData,
  stores: SignalStores
): Promise<void> {
  // Serialize current store state into session data
  sessionData.userStores = serializeStores(stores)
  
  // Save updated session to disk
  await saveSession(dataDir, sessionData)
}

// =============================================================================
// SESSION RESET
// =============================================================================

/**
 * Reset the session by creating a new one.
 * 
 * This is a convenience wrapper around createNewSession(). It creates
 * a completely fresh session, discarding any existing data.
 * 
 * Used when:
 * - User explicitly requests reset (Ctrl+R)
 * - Session is corrupted beyond repair
 * - User wants to start fresh for privacy
 * 
 * @param dataDir - Directory for new session file
 * @param model - Ollama model for new session
 * @returns Promise<SessionContext> - Fresh session context
 */
export async function resetSession(
  dataDir: string,
  model: string = DEFAULT_MODEL
): Promise<SessionContext> {
  return createNewSession(dataDir, model)
}

// =============================================================================
// SECURITY NOTES
// =============================================================================

/**
 * Security Considerations for Session Storage:
 * 
 * 1. File Permissions:
 *    - Session files contain sensitive private keys
 *    - Should use restrictive permissions (0600) - owner read/write only
 *    - Not implemented in this code; relies on container/user configuration
 * 
 * 2. Encryption at Rest:
 *    - Currently stores keys as base64 in JSON
 *    - No additional encryption of the session file itself
 *    - For production, consider encrypting with user password or hardware key
 * 
 * 3. Backup:
 *    - Session file contains keys needed to decrypt all messages
 *    - Backup strategy must protect this sensitive data
 *    - Loss of session file = loss of ability to decrypt history
 * 
 * 4. Version Migration:
 *    - Session format has version field for future migrations
 *    - Currently no migration logic implemented
 *    - Would need to handle format changes between versions
 * 
 * 5. Corruption Detection:
 *    - Basic error handling catches deserialization failures
 *    - Could add integrity checks (checksums, signatures)
 *    - Currently falls back to creating new session on corruption
 * 
 * 6. Multi-Device:
 *    - Not supported; session tied to single device
 *    - Real Signal has complex multi-device synchronization
 */
