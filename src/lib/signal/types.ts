/**
 * Signal Protocol Type Definitions
 * 
 * This module defines the TypeScript types for the Signal Protocol (Double Ratchet)
 * implementation. The Signal Protocol provides end-to-end encryption with:
 * - X3DH (Extended Triple Diffie-Hellman) for initial key exchange
 * - Double Ratchet Algorithm for message encryption with forward secrecy
 * - Post-quantum Kyber-1024 key encapsulation
 * 
 * These types wrap the official @signalapp/libsignal-client library's types
 * to provide a more ergonomic interface for our application.
 */

// =============================================================================
// EXTERNAL TYPE IMPORTS
// =============================================================================
// Import cryptographic types from the official Signal library

import type {
  PrivateKey,      // Curve25519 private key for signing and key exchange
  PublicKey,       // Curve25519 public key for verification and key exchange
  KEMPublicKey,    // Kyber post-quantum public key
  KEMSecretKey,    // Kyber post-quantum secret key
} from '@signalapp/libsignal-client'

// =============================================================================
// KEY PAIR TYPES
// =============================================================================

/**
 * Identity key pair for the Signal Protocol.
 * 
 * The identity key is a long-term Curve25519 key pair that identifies a user
 * or device in the Signal network. Unlike pre-keys which are rotated regularly,
 * the identity key should remain stable (though it can be regenerated if needed).
 * 
 * Security Note:
 * - The private key MUST be kept secret and protected at all costs
 * - The public key can be shared with other parties to establish sessions
 * - Compromising the identity key breaks the security of all past and future sessions
 * 
 * @security
 * The privateKey field contains highly sensitive material. Ensure proper
 * storage encryption and access controls.
 */
export interface IdentityKeyPair {
  /** 
   * Curve25519 private key
   * Used for signing pre-keys and X3DH key agreement
   * NEVER expose or log this value
   */
  privateKey: PrivateKey
  
  /** 
   * Curve25519 public key
   * Used by other parties to verify signatures and perform X3DH
   * Can be freely shared
   */
  publicKey: PublicKey
}

/**
 * Post-quantum Kyber key pair for hybrid encryption.
 * 
 * Kyber is a NIST-standardized post-quantum key encapsulation mechanism (KEM).
 * Combined with Curve25519, this provides protection against both classical
 * and quantum computer attacks.
 * 
 * The Signal Protocol v4 includes Kyber pre-keys to provide "harvest now,
 * decrypt later" protection - even if an attacker records encrypted messages
 * today, they cannot decrypt them even with a future quantum computer.
 * 
 * @security
 * Both keys are sensitive. The secretKey is particularly critical.
 */
export interface KyberKeyPairData {
  /** Kyber public key for encapsulation */
  publicKey: KEMPublicKey
  
  /** Kyber secret key for decapsulation */
  secretKey: KEMSecretKey
}

// =============================================================================
// PRE-KEY TYPES
// =============================================================================

/**
 * One-time pre-key for X3DH initial handshake.
 * 
 * Pre-keys are ephemeral Curve25519 key pairs used during the initial
 * X3DH key agreement. Each pre-key can only be used once, providing
 * forward secrecy for the initial message.
 * 
 * We generate a batch of pre-keys (typically 10) at session creation.
 * When a pre-key is consumed (used in a handshake), it's removed from
 * storage and cannot be used again.
 * 
 * Workflow:
 * 1. Alice publishes her pre-keys to a server
 * 2. Bob retrieves one of Alice's pre-keys
 * 3. Bob uses it in X3DH to derive initial session keys
 * 4. The pre-key is deleted and never reused
 * 
 * @security
 * Pre-keys are single-use only. Once used, they must be deleted immediately.
 */
export interface PreKeyData {
  /** 
   * Numeric ID for this pre-key
   * IDs typically range from 1 to 10 (or more)
   * Used to identify which pre-key was consumed in a session
   */
  id: number
  
  /** Public key to share with other parties */
  publicKey: PublicKey
  
  /** Private key for decrypting initial messages */
  privateKey: PrivateKey
}

/**
 * Signed pre-key for X3DH with authentication.
 * 
 * Unlike regular pre-keys, signed pre-keys are longer-lived (typically
 * rotated every 1-4 weeks). They provide authentication because they're
 * signed by the identity key, proving they belong to the claimed identity.
 * 
 * The signature allows parties to verify that the pre-key was legitimately
 * created by the owner of the identity key, preventing man-in-the-middle
 * attacks on the initial handshake.
 * 
 * Rotation Strategy:
 * - Keep the current signed pre-key active for a period
 * - Generate a new one periodically
 * - Keep the old one briefly to handle in-flight messages
 * - Eventually retire and delete old signed pre-keys
 * 
 * @security
 * The signature proves authenticity. If the signature is invalid,
 * the pre-key must be rejected.
 */
export interface SignedPreKeyData {
  /** Numeric ID for this signed pre-key */
  id: number
  
  /** 
   * Unix timestamp when this pre-key was created
   * Used for determining rotation schedule
   */
  timestamp: number
  
  /** Public key to share with other parties */
  publicKey: PublicKey
  
  /** Private key for decrypting messages */
  privateKey: PrivateKey
  
  /** 
   * Signature of the public key using the identity key
   * Format: Ed25519 signature over the serialized public key bytes
   */
  signature: Uint8Array
}

/**
 * Post-quantum Kyber pre-key for hybrid encryption.
 * 
 * Similar to signed pre-keys, but using Kyber post-quantum cryptography.
 * Provides protection against quantum computers in the initial handshake.
 * 
 * The Kyber pre-key is also signed by the identity key for authentication.
 * When combined with Curve25519 pre-keys, this provides a hybrid approach
 * that's secure against both classical and quantum attacks.
 * 
 * @security
 * The Kyber key pair is single-use like regular pre-keys.
 * Once used in a handshake, it must be deleted.
 */
export interface KyberPreKeyData {
  /** Numeric ID for this Kyber pre-key */
  id: number
  
  /** Unix timestamp when this pre-key was created */
  timestamp: number
  
  /** Kyber public key for encapsulation */
  publicKey: KEMPublicKey
  
  /** Kyber secret key for decapsulation */
  secretKey: KEMSecretKey
  
  /** Signature of the Kyber public key using the identity key */
  signature: Uint8Array
}

// =============================================================================
// IDENTITY BUNDLE TYPES
// =============================================================================

/**
 * Complete identity bundle for a party in the Signal Protocol.
 * 
 * An identity bundle contains all the cryptographic material needed for
 * another party to initiate a session. It's typically published to a
 * server (like Signal's servers) where other users can retrieve it.
 * 
 * The bundle includes:
 * - Registration ID (unique identifier in the Signal ecosystem)
 * - Identity key pair (long-term identity)
 * - Signed pre-key (medium-term, authenticated)
 * - One-time pre-keys (ephemeral, single-use)
 * - Kyber post-quantum pre-key (quantum-resistant)
 * 
 * Security Considerations:
 * - The private keys in this bundle are extremely sensitive
 * - This should only be shared with trusted parties
 * - The bundle should be transmitted over an authenticated channel
 * 
 * @example
 * {
 *   registrationId: 12345,
 *   identityKeyPair: { privateKey: ..., publicKey: ... },
 *   signedPreKey: { id: 1, publicKey: ..., signature: ... },
 *   preKeys: [{ id: 1, publicKey: ... }, ...],
 *   kyberPreKey: { id: 1, publicKey: ..., signature: ... }
 * }
 */
export interface IdentityBundle {
  /** 
   * Registration ID
   * A unique identifier assigned to this device/user in the Signal network
   * Used to route messages and identify sessions
   * Range: 1 to 16380 (avoiding values reserved for special purposes)
   */
  registrationId: number
  
  /** 
   * Long-term identity key pair
   * The cryptographic identity of this party
   * Used for signing pre-keys and X3DH authentication
   */
  identityKeyPair: IdentityKeyPair
  
  /** 
   * Signed pre-key
   * Medium-term key used in X3DH
   * Signed by the identity key for authentication
   */
  signedPreKey: SignedPreKeyData
  
  /** 
   * Array of one-time pre-keys
   * Ephemeral keys for X3DH forward secrecy
   * Each can only be used once
   */
  preKeys: PreKeyData[]
  
  /** 
   * Post-quantum Kyber pre-key
   * Provides quantum-resistant encryption
   * Signed by the identity key
   */
  kyberPreKey: KyberPreKeyData
}

// =============================================================================
// SERIALIZED IDENTITY BUNDLE
// =============================================================================

/**
 * JSON-serializable version of the identity bundle.
 * 
 * This interface represents the identity bundle in a format suitable for
 * storage in JSON files. All binary data (keys, signatures) are base64-encoded
 * as strings for serialization.
 * 
 * The structure mirrors IdentityBundle but replaces cryptographic objects
 * with their base64-encoded string representations.
 * 
 * Serialization Process:
 * 1. Extract raw bytes from each key object
 * 2. Encode bytes as base64 strings
 * 3. Store in JSON-compatible structure
 * 
 * Deserialization Process:
 * 1. Parse JSON to get base64 strings
 * 2. Decode base64 to raw bytes
 * 3. Create key objects from bytes using library constructors
 * 
 * @example
 * {
 *   registrationId: 12345,
 *   identityKeyPair: {
 *     privateKey: 'base64EncodedPrivateKey...',
 *     publicKey: 'base64EncodedPublicKey...'
 *   },
 *   ...
 * }
 */
export interface SerializedIdentityBundle {
  /** Registration ID as a number */
  registrationId: number
  
  /** Identity key pair with base64-encoded keys */
  identityKeyPair: {
    /** Base64-encoded private key */
    privateKey: string
    /** Base64-encoded public key */
    publicKey: string
  }
  
  /** Signed pre-key with base64-encoded fields */
  signedPreKey: {
    id: number
    timestamp: number
    publicKey: string
    privateKey: string
    signature: string  // Base64-encoded signature
  }
  
  /** Array of pre-keys with base64-encoded keys */
  preKeys: Array<{
    id: number
    publicKey: string
    privateKey: string
  }>
  
  /** Kyber pre-key with base64-encoded fields */
  kyberPreKey: {
    id: number
    timestamp: number
    publicKey: string
    secretKey: string
    signature: string  // Base64-encoded signature
  }
}

// =============================================================================
// TYPE CONVERSION NOTES
// =============================================================================

/**
 * Converting between IdentityBundle and SerializedIdentityBundle:
 * 
 * To serialize (for storage):
 * - Call .serialize() on key objects to get Uint8Array
 * - Convert Uint8Array to base64 string using Buffer
 * - Store in SerializedIdentityBundle structure
 * 
 * To deserialize (for use):
 * - Decode base64 string to Uint8Array using Buffer
 * - Call library constructors (e.g., PrivateKey.deserialize())
 * - Assemble into IdentityBundle structure
 * 
 * See identities.ts for the implementation of these conversions.
 */
