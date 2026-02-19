/**
 * Signal Protocol Store Implementations
 * 
 * This module provides in-memory implementations of the Signal Protocol's
 * storage interfaces. The Signal library requires these stores to persist:
 * - Session state (Double Ratchet state per conversation)
 * - Identity keys (public keys of other users)
 * - Pre-keys (one-time use keys for initial handshake)
 * - Signed pre-keys (medium-term authenticated keys)
 * - Kyber pre-keys (post-quantum keys)
 * 
 * All stores are in-memory only during runtime but can be serialized to
 * base64-encoded JSON for persistent storage between application runs.
 * 
 * Architecture Notes:
 * - Each store extends an abstract base class from libsignal-client
 * - All stores implement serialize()/deserialize() for persistence
 * - Thread-safe within single-threaded JavaScript (no explicit locking needed)
 * - Uses Map for O(1) lookups
 */

// =============================================================================
// EXTERNAL IMPORTS
// =============================================================================
// Import types and base classes from the official Signal library

import {
  SessionStore,           // Abstract base class for session storage
  IdentityKeyStore,       // Abstract base class for identity key storage
  PreKeyStore,            // Abstract base class for pre-key storage
  SignedPreKeyStore,      // Abstract base class for signed pre-key storage
  KyberPreKeyStore,       // Abstract base class for Kyber pre-key storage
  SessionRecord,          // Represents a Double Ratchet session state
  ProtocolAddress,        // Identifies a Signal user (name + device ID)
  PrivateKey,             // Curve25519 private key
  PublicKey,              // Curve25519 public key
  PreKeyRecord,           // One-time pre-key record
  SignedPreKeyRecord,     // Signed pre-key record
  KyberPreKeyRecord,      // Kyber post-quantum pre-key record
  Direction,              // Enum: sending or receiving direction
  IdentityChange,         // Enum: identity key change status
} from '@signalapp/libsignal-client'

// =============================================================================
// SESSION STORE
// =============================================================================

/**
 * In-memory implementation of the Signal Protocol session store.
 * 
 * The session store maintains the Double Ratchet state for each conversation
 * partner. Each session contains:
 * - Root key (derived from X3DH initial handshake)
 * - Sending chain key and message number
 * - Receiving chain key and message number
 * - Message key cache for out-of-order messages
 * 
 * Storage Key Format: "name::deviceId"
 * Example: "assistant::1" or "user::1"
 * 
 * Security Note:
 * Session state contains keys derived from long-term secrets. If leaked,
 * an attacker could decrypt messages, but only from that specific session.
 * The leakage is limited due to forward secrecy.
 */
export class InMemorySessionStore extends SessionStore {
  /**
   * Internal Map storing serialized session records.
   * Key format: "name::deviceId" (e.g., "assistant::1")
   * Value: Serialized SessionRecord as Uint8Array
   */
  private state = new Map<string, Uint8Array>()

  /**
   * Save a session record for a specific protocol address.
   * 
   * Called by the Signal library after session state changes (e.g., after
   * sending or receiving a message). The session must be serialized before
   * storage because the library manages the serialization format.
   * 
   * @param name - ProtocolAddress identifying the session partner
   * @param record - SessionRecord containing Double Ratchet state
   */
  async saveSession(
    name: ProtocolAddress,
    record: SessionRecord
  ): Promise<void> {
    // Create unique index from name and device ID
    // Format: "username::deviceId"
    const idx = `${name.name()}::${name.deviceId()}`
    // Store serialized record bytes
    this.state.set(idx, record.serialize())
  }

  /**
   * Retrieve a session record by protocol address.
   * 
   * Called when encrypting or decrypting a message. Returns null if no
   * session exists for this address, which typically means this is the
   * first message to/from this recipient.
   * 
   * @param name - ProtocolAddress of the session partner
   * @returns SessionRecord if found, null otherwise
   */
  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    const idx = `${name.name()}::${name.deviceId()}`
    const serialized = this.state.get(idx)
    if (serialized) {
      // Deserialize bytes back into SessionRecord object
      return SessionRecord.deserialize(serialized)
    }
    return null
  }

  /**
   * Retrieve multiple existing sessions by their addresses.
   * 
   * Used when processing a bundle of messages. Throws an error if any
   * session doesn't exist, unlike getSession which returns null.
   * 
   * @param addresses - Array of ProtocolAddresses to look up
   * @returns Array of SessionRecords in the same order as addresses
   * @throws Error if any session is not found
   */
  async getExistingSessions(
    addresses: ProtocolAddress[]
  ): Promise<SessionRecord[]> {
    return addresses.map((address) => {
      const idx = `${address.name()}::${address.deviceId()}`
      const serialized = this.state.get(idx)
      if (!serialized) {
        throw new Error(`no session for ${idx}`)
      }
      return SessionRecord.deserialize(serialized)
    })
  }

  /**
   * Serialize session store state to JSON-compatible format.
   * 
   * Converts the internal Map to a plain object with base64-encoded values.
   * This format can be safely stored in JSON files.
   * 
   * @returns Record with session keys and base64-encoded values
   */
  serialize(): Record<string, string> {
    const result: Record<string, string> = {}
    this.state.forEach((value, key) => {
      // Convert Uint8Array to base64 string for JSON serialization
      result[key] = Buffer.from(value).toString('base64')
    })
    return result
  }

  /**
   * Deserialize and restore session store state.
   * 
   * Clears any existing state and loads new data from a serialized object.
   * Base64 strings are decoded back to Uint8Array for internal storage.
   * 
   * @param data - Record with base64-encoded session data
   */
  deserialize(data: Record<string, string>): void {
    // Clear existing state to avoid mixing old and new data
    this.state.clear()
    Object.entries(data).forEach(([key, value]) => {
      // Decode base64 string back to Uint8Array
      this.state.set(key, Buffer.from(value, 'base64'))
    })
  }
}

// =============================================================================
// IDENTITY KEY STORE
// =============================================================================

/**
 * In-memory implementation of the Signal identity key store.
 * 
 * The identity store maintains a mapping of protocol addresses to their
 * identity public keys. This enables:
 * - Trust on first use (TOFU) verification
 * - Detection of identity key changes
 * - Authentication of incoming messages
 * 
 * In our two-party chat model, this stores the other party's identity key
 * after the initial X3DH handshake.
 * 
 * The store also holds our own identity key pair and registration ID,
 * which are needed for X3DH operations and session establishment.
 * 
 * Security Considerations:
 * - Identity keys are long-term and critical for security
 * - Changes to identity keys should be carefully verified
 * - This implementation trusts all identities by default (isTrustedIdentity returns true)
 *   In production, you might want stricter verification.
 */
export class InMemoryIdentityKeyStore extends IdentityKeyStore {
  /**
   * Map storing other parties' identity public keys.
   * Key: "name::deviceId" (e.g., "assistant::1")
   * Value: PublicKey object
   */
  private idKeys = new Map<string, PublicKey>()
  
  /** Our local registration ID for this device */
  private localRegistrationId: number
  
  /** Our long-term identity private key (Curve25519) */
  private identityKey: PrivateKey

  /**
   * Create a new identity key store.
   * 
   * @param identityKey - Our private key for signing and X3DH
   * @param registrationId - Unique identifier for this device
   */
  constructor(identityKey: PrivateKey, registrationId: number) {
    super()
    this.identityKey = identityKey
    this.localRegistrationId = registrationId
  }

  /**
   * Get our identity private key.
   * 
   * Used during X3DH operations and for signing pre-keys.
   * 
   * @returns PrivateKey - Our Curve25519 identity private key
   */
  async getIdentityKey(): Promise<PrivateKey> {
    return this.identityKey
  }

  /**
   * Get our registration ID.
   * 
   * The registration ID is a unique identifier for this device in the
   * Signal ecosystem. It's used in X3DH key derivation.
   * 
   * @returns number - Registration ID (1-16380)
   */
  async getLocalRegistrationId(): Promise<number> {
    return this.localRegistrationId
  }

  /**
   * Check if an identity key is trusted.
   * 
   * This is called when receiving a message from a new or existing contact.
   * In this implementation, we trust all identities unconditionally.
   * 
   * In a production app, you might:
   * - Check against a known-good key stored securely
   * - Show a security warning if the key changed (key change = possible MITM)
   * - Require user confirmation for new identities
   * 
   * @param _name - Protocol address of the sender (unused)
   * @param _key - Identity public key to verify (unused)
   * @param _direction - Whether this is for sending or receiving (unused)
   * @returns boolean - Always true in this implementation
   */
  async isTrustedIdentity(
    _name: ProtocolAddress,
    _key: PublicKey,
    _direction: Direction
  ): Promise<boolean> {
    return true
  }

  /**
   * Save an identity public key for a protocol address.
   * 
   * Called when we first communicate with a new party or when their
   * identity key changes. We store the key for future message verification.
   * 
   * @param name - ProtocolAddress of the identity owner
   * @param key - Their identity public key
   * @returns IdentityChange - Whether this is a new key or replaced an existing one
   */
  async saveIdentity(
    name: ProtocolAddress,
    key: PublicKey
  ): Promise<IdentityChange> {
    const idx = `${name.name()}::${name.deviceId()}`
    const currentKey = this.idKeys.get(idx)
    this.idKeys.set(idx, key)

    // Determine if this is a new identity or a replacement
    let changed = true
    if (currentKey) {
      // Compare key bytes to detect changes
      const currentBytes = currentKey.serialize()
      const newBytes = key.serialize()
      changed = !currentBytes.every((byte, i) => byte === newBytes[i])
    }
    
    // Return appropriate enum value
    return changed
      ? IdentityChange.ReplacedExisting
      : IdentityChange.NewOrUnchanged
  }

  /**
   * Get the identity public key for a protocol address.
   * 
   * Used to verify message signatures and perform X3DH operations.
   * Returns null if we haven't stored this identity yet.
   * 
   * @param name - ProtocolAddress to look up
   * @returns PublicKey | null - Their identity key if known
   */
  async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
    const idx = `${name.name()}::${name.deviceId()}`
    return this.idKeys.get(idx) ?? null
  }

  /**
   * Serialize identity store to JSON-compatible format.
   * 
   * Serializes our identity key, registration ID, and all stored
   * identity public keys to base64-encoded strings.
   * 
   * @returns Object with serialized identity data
   */
  serialize(): { identityKey: string; registrationId: number; identityKeys: Record<string, string> } {
    const identityKeys: Record<string, string> = {}
    // Serialize each stored identity key to base64
    this.idKeys.forEach((value, key) => {
      identityKeys[key] = Buffer.from(value.serialize()).toString('base64')
    })
    return {
      identityKey: Buffer.from(this.identityKey.serialize()).toString('base64'),
      registrationId: this.localRegistrationId,
      identityKeys,
    }
  }

  /**
   * Deserialize and restore identity store state (instance method).
   * 
   * This restores the stored identity keys map but does NOT restore
   * the identity key pair or registration ID. Those are constructor
   * parameters and should be passed when creating the store.
   * 
   * @param data - Serialized identity data
   */
  deserialize(data: { identityKey: string; registrationId: number; identityKeys: Record<string, string> }): void {
    // Clear existing stored identities
    this.idKeys.clear()
    // Restore each identity key from base64
    Object.entries(data.identityKeys).forEach(([key, value]) => {
      this.idKeys.set(key, PublicKey.deserialize(Buffer.from(value, 'base64')))
    })
  }

  /**
   * Static factory method to create a store from serialized data.
   * 
   * Unlike the instance deserialize() method, this static method
   * creates a completely new InMemoryIdentityKeyStore with all
   * data restored, including the identity key pair and registration ID.
   * 
   * @param data - Complete serialized store data
   * @returns Promise<InMemoryIdentityKeyStore> - Newly created store
   */
  static async deserialize(data: { identityKey: string; registrationId: number; identityKeys: Record<string, string> }): Promise<InMemoryIdentityKeyStore> {
    // Deserialize the identity private key
    const identityKey = PrivateKey.deserialize(Buffer.from(data.identityKey, 'base64'))
    // Create new store with restored identity
    const store = new InMemoryIdentityKeyStore(identityKey, data.registrationId)
    // Restore stored identity keys
    Object.entries(data.identityKeys).forEach(([key, value]) => {
      store.idKeys.set(key, PublicKey.deserialize(Buffer.from(value, 'base64')))
    })
    return store
  }
}

// =============================================================================
// PRE-KEY STORE
// =============================================================================

/**
 * In-memory implementation of the Signal pre-key store.
 * 
 * Pre-keys are ephemeral Curve25519 key pairs used in the initial X3DH
 * handshake. Each pre-key can only be used once, providing forward secrecy
 * for the initial message.
 * 
 * Key lifecycle:
 * 1. Generate batch of pre-keys (typically 10-100) during identity creation
 * 2. Upload public pre-keys to a server (simulated in our case)
 * 3. When a pre-key is used in a handshake, it's immediately deleted
 * 4. Periodically replenish the pre-key supply
 * 
 * In our two-party chat:
 * - Each party generates pre-keys
 * - They exchange pre-key bundles during session establishment
 * - Pre-keys are consumed and deleted during the handshake
 */
export class InMemoryPreKeyStore extends PreKeyStore {
  /**
   * Map storing pre-key records by their numeric ID.
   * Key: Pre-key ID (number)
   * Value: Serialized PreKeyRecord
   */
  private state = new Map<number, Uint8Array>()

  /**
   * Save a pre-key record.
   * 
   * Called during initial key generation to store newly created pre-keys.
   * 
   * @param id - Numeric ID for this pre-key
   * @param record - PreKeyRecord containing the key pair
   */
  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.state.set(id, record.serialize())
  }

  /**
   * Get a pre-key by ID.
   * 
   * Called during X3DH handshake to retrieve the private key needed to
   * decrypt the initial message. The pre-key should be deleted after use
   * via removePreKey().
   * 
   * @param id - Pre-key ID to retrieve
   * @returns PreKeyRecord - The requested pre-key
   * @throws Error if pre-key not found (already used or never existed)
   */
  async getPreKey(id: number): Promise<PreKeyRecord> {
    const record = this.state.get(id)
    if (!record) {
      throw new Error(`pre-key ${id} not found`)
    }
    return PreKeyRecord.deserialize(record)
  }

  /**
   * Remove (delete) a pre-key after use.
   * 
   * This is critical for forward secrecy. Once a pre-key is used in an
   * X3DH handshake, it must be immediately deleted and never reused.
   * 
   * @param id - Pre-key ID to delete
   */
  async removePreKey(id: number): Promise<void> {
    this.state.delete(id)
  }

  /**
   * Serialize pre-key store to JSON-compatible format.
   * 
   * @returns Record with pre-key IDs as keys and base64-encoded records
   */
  serialize(): Record<number, string> {
    const result: Record<number, string> = {}
    this.state.forEach((value, key) => {
      result[key] = Buffer.from(value).toString('base64')
    })
    return result
  }

  /**
   * Deserialize and restore pre-key store.
   * 
   * @param data - Record with base64-encoded pre-key data
   */
  deserialize(data: Record<number, string>): void {
    this.state.clear()
    Object.entries(data).forEach(([key, value]) => {
      this.state.set(Number(key), Buffer.from(value, 'base64'))
    })
  }
}

// =============================================================================
// SIGNED PRE-KEY STORE
// =============================================================================

/**
 * In-memory implementation of the Signal signed pre-key store.
 * 
 * Signed pre-keys are medium-term Curve25519 key pairs used in X3DH.
 * Unlike regular pre-keys, they:
 * - Are signed by the identity key for authentication
 * - Last longer (typically 1-4 weeks)
 * - Can be used multiple times (but shouldn't be)
 * - Provide a fallback if one-time pre-keys are exhausted
 * 
 * The signature proves the signed pre-key was created by the owner of
 * the identity key, preventing man-in-the-middle attacks on the initial
 * handshake.
 * 
 * Rotation strategy:
 * - Keep current signed pre-key active
 * - Generate new one periodically
 * - Accept messages with old signed pre-key briefly (in-flight messages)
 * - Eventually delete old signed pre-keys
 */
export class InMemorySignedPreKeyStore extends SignedPreKeyStore {
  /**
   * Map storing signed pre-key records by their numeric ID.
   * Key: Signed pre-key ID (number)
   * Value: Serialized SignedPreKeyRecord
   */
  private state = new Map<number, Uint8Array>()

  /**
   * Save a signed pre-key record.
   * 
   * Called when generating new signed pre-keys (during initial setup
   * and periodically during rotation).
   * 
   * @param id - Numeric ID for this signed pre-key
   * @param record - SignedPreKeyRecord containing the key pair and signature
   */
  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.state.set(id, record.serialize())
  }

  /**
   * Get a signed pre-key by ID.
   * 
   * Called during X3DH handshake. Unlike regular pre-keys, signed pre-keys
   * are not deleted after use because they're meant to be used multiple
   * times (though in practice, each X3DH handshake should use a unique
   * one-time pre-key if available).
   * 
   * @param id - Signed pre-key ID to retrieve
   * @returns SignedPreKeyRecord - The requested signed pre-key
   * @throws Error if signed pre-key not found
   */
  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const record = this.state.get(id)
    if (!record) {
      throw new Error(`signed pre-key ${id} not found`)
    }
    return SignedPreKeyRecord.deserialize(record)
  }

  /**
   * Serialize signed pre-key store to JSON-compatible format.
   * 
   * @returns Record with signed pre-key IDs as keys and base64-encoded records
   */
  serialize(): Record<number, string> {
    const result: Record<number, string> = {}
    this.state.forEach((value, key) => {
      result[key] = Buffer.from(value).toString('base64')
    })
    return result
  }

  /**
   * Deserialize and restore signed pre-key store.
   * 
   * @param data - Record with base64-encoded signed pre-key data
   */
  deserialize(data: Record<number, string>): void {
    this.state.clear()
    Object.entries(data).forEach(([key, value]) => {
      this.state.set(Number(key), Buffer.from(value, 'base64'))
    })
  }
}

// =============================================================================
// KYBER PRE-KEY STORE (Post-Quantum)
// =============================================================================

/**
 * In-memory implementation of the Signal Kyber pre-key store.
 * 
 * Kyber is a NIST-standardized post-quantum key encapsulation mechanism (KEM).
 * The Signal Protocol v4 adds Kyber pre-keys to provide protection against
 * quantum computers.
 * 
 * How it works:
 * - Kyber pre-keys are generated alongside Curve25519 pre-keys
 * - During X3DH, both types of pre-keys are used
 * - This creates a hybrid key that requires breaking both classical
 *   (Curve25519) and post-quantum (Kyber) cryptography
 * 
 * Security Benefits:
 * - Protection against "harvest now, decrypt later" attacks
 * - Even if quantum computers break Curve25519 in the future,
 *   Kyber remains secure
 * - Hybrid approach: both must be broken to compromise the key
 * 
 * Similar to regular pre-keys, Kyber pre-keys are single-use and should
 * be deleted after use.
 */
export class InMemoryKyberPreKeyStore extends KyberPreKeyStore {
  /**
   * Map storing Kyber pre-key records by their numeric ID.
   * Key: Kyber pre-key ID (number)
   * Value: Serialized KyberPreKeyRecord
   */
  private state = new Map<number, Uint8Array>()

  /**
   * Save a Kyber pre-key record.
   * 
   * Called during initial key generation to store newly created Kyber pre-keys.
   * 
   * @param id - Numeric ID for this Kyber pre-key
   * @param record - KyberPreKeyRecord containing the key pair and signature
   */
  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.state.set(id, record.serialize())
  }

  /**
   * Get a Kyber pre-key by ID.
   * 
   * Called during X3DH handshake for post-quantum key exchange.
   * 
   * @param id - Kyber pre-key ID to retrieve
   * @returns KyberPreKeyRecord - The requested Kyber pre-key
   * @throws Error if Kyber pre-key not found
   */
  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const record = this.state.get(id)
    if (!record) {
      throw new Error(`kyber pre-key ${id} not found`)
    }
    return KyberPreKeyRecord.deserialize(record)
  }

  /**
   * Mark a Kyber pre-key as used.
   * 
   * This is called after the pre-key is used in an X3DH handshake.
   * In this implementation, it's a no-op because we delete pre-keys
   * immediately after use in practice. A production implementation
   * might track used pre-keys for analytics or debugging.
   * 
   * @param _kyberPreKeyId - ID of the used Kyber pre-key
   * @param _signedPreKeyId - ID of the corresponding signed pre-key
   * @param _baseKey - Base key used in the handshake
   */
  async markKyberPreKeyUsed(
    _kyberPreKeyId: number,
    _signedPreKeyId: number,
    _baseKey: PublicKey
  ): Promise<void> {
    // No-op for in-memory store
    // In a production app, you might want to track usage for:
    // - Analytics on pre-key consumption rate
   // - Detecting suspicious patterns
    // - Debugging
  }

  /**
   * Serialize Kyber pre-key store to JSON-compatible format.
   * 
   * @returns Record with Kyber pre-key IDs as keys and base64-encoded records
   */
  serialize(): Record<number, string> {
    const result: Record<number, string> = {}
    this.state.forEach((value, key) => {
      result[key] = Buffer.from(value).toString('base64')
    })
    return result
  }

  /**
   * Deserialize and restore Kyber pre-key store.
   * 
   * @param data - Record with base64-encoded Kyber pre-key data
   */
  deserialize(data: Record<number, string>): void {
    this.state.clear()
    Object.entries(data).forEach(([key, value]) => {
      this.state.set(Number(key), Buffer.from(value, 'base64'))
    })
  }
}

// =============================================================================
// STORE COLLECTION TYPES
// =============================================================================

/**
 * Collection of all Signal Protocol stores for one party.
 * 
 * This interface groups together all five store types needed for
 * Signal Protocol operations. We maintain two collections:
 * - userStores: For the human user
 * - assistantStores: For the AI assistant
 * 
 * Having separate stores for each party allows bidirectional
 * encryption where both sides can encrypt and decrypt messages.
 * 
 * This is different from typical Signal usage where each user
 * has one set of stores and communicates with many others.
 */
export interface SignalStores {
  /** Session store for Double Ratchet state */
  session: InMemorySessionStore
  /** Identity store for public key management */
  identity: InMemoryIdentityKeyStore
  /** Pre-key store for one-time keys */
  preKey: InMemoryPreKeyStore
  /** Signed pre-key store for authenticated medium-term keys */
  signedPreKey: InMemorySignedPreKeyStore
  /** Kyber pre-key store for post-quantum security */
  kyberPreKey: InMemoryKyberPreKeyStore
}

/**
 * Serialized representation of SignalStores.
 * 
 * This is the format used for persistent storage. All binary data
 * is encoded as base64 strings for JSON compatibility.
 */
export interface SerializedStores {
  /** Base64-encoded session records */
  session: Record<string, string>
  /** Identity data with base64-encoded keys */
  identity: {
    identityKey: string
    registrationId: number
    identityKeys: Record<string, string>
  }
  /** Base64-encoded pre-key records */
  preKey: Record<number, string>
  /** Base64-encoded signed pre-key records */
  signedPreKey: Record<number, string>
  /** Base64-encoded Kyber pre-key records */
  kyberPreKey: Record<number, string>
}

// =============================================================================
// USAGE NOTES
// =============================================================================

/**
 * Store Lifecycle:
 * 
 * 1. Creation:
 *    - Generate identity keys
 *    - Create stores with identity keys
 *    - Generate and store pre-keys
 * 
 * 2. Session Establishment:
 *    - Exchange pre-key bundles
 *    - Process remote pre-key bundle
 *    - Create session record
 *    - Save session to store
 * 
 * 3. Message Exchange:
 *    - Encrypt: Load session, encrypt message, save updated session
 *    - Decrypt: Load session, decrypt message, save updated session
 *    - Double Ratchet updates session state automatically
 * 
 * 4. Persistence:
 *    - Call serialize() on each store
 *    - Save to JSON file
 *    - On restart, deserialize() to restore state
 * 
 * 5. Cleanup:
 *    - Delete used one-time pre-keys
 *    - Rotate signed pre-keys periodically
 *    - Replenish pre-key supply
 */
