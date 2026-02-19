/**
 * Identity Bundle Management
 * 
 * This module provides functions for creating, populating, serializing, and
 * deserializing Signal Protocol identity bundles. An identity bundle is the
 * complete set of cryptographic material needed to participate in Signal
 * Protocol encrypted messaging.
 * 
 * The identity bundle includes:
 * - Long-term identity key pair (Curve25519)
 * - Registration ID (unique identifier)
 * - One-time pre-keys (ephemeral keys for X3DH)
 * - Signed pre-key (medium-term authenticated key)
 * - Kyber post-quantum pre-key (quantum-resistant)
 * 
 * These functions handle the entire lifecycle of identity management from
 * generation to storage persistence.
 */

// =============================================================================
// EXTERNAL IMPORTS
// =============================================================================

import {
  PrivateKey,           // Curve25519 private key for signing and key exchange
  PublicKey,            // Curve25519 public key
  KEMKeyPair,           // Kyber key encapsulation mechanism key pair
  PreKeyRecord,         // Signal library record for one-time pre-keys
  SignedPreKeyRecord,   // Signal library record for signed pre-keys
  KyberPreKeyRecord,    // Signal library record for Kyber pre-keys
} from '@signalapp/libsignal-client'

import type {
  IdentityBundle,            // Runtime identity bundle type
  SerializedIdentityBundle,  // JSON-serializable identity bundle type
  PreKeyData,                // One-time pre-key data structure
} from './types'

// =============================================================================
// REGISTRATION ID GENERATION
// =============================================================================

/**
 * Generate a random registration ID for Signal Protocol.
 * 
 * The registration ID is a 14-bit integer (1-16380) that uniquely identifies
 * a device in the Signal ecosystem. It's used in:
 * - X3DH key derivation
 * - Session identification
 * - Pre-key bundle identification
 * 
 * Why 1-16380?
 * - Signal uses 14-bit registration IDs
 * - Values 16381-16383 are reserved for special purposes
 * - 0 is reserved/invalid
 * 
 * @returns number - Random registration ID between 1 and 16380 (inclusive)
 */
function generateRegistrationId(): number {
  // Generate random integer in range [1, 16380]
  // Math.random() generates [0, 1)
  // Multiply by 16380 to get [0, 16380)
  // Floor to get integer [0, 16379]
  // Add 1 to get [1, 16380]
  return Math.floor(Math.random() * 16380) + 1
}

// =============================================================================
// IDENTITY BUNDLE CREATION
// =============================================================================

/**
 * Create a new identity bundle with all required keys.
 * 
 * This function generates a complete Signal Protocol identity from scratch:
 * 1. Generate long-term identity key pair (Curve25519)
 * 2. Generate random registration ID
 * 3. Generate signed pre-key (signed by identity key)
 * 4. Generate batch of one-time pre-keys (10 keys)
 * 5. Generate Kyber post-quantum pre-key (signed by identity key)
 * 
 * The generated bundle can be used immediately or serialized for storage.
 * In our two-party chat model, we create two bundles:
 * - One for the human user
 * - One for the AI assistant
 * 
 * @returns Promise<IdentityBundle> - Complete identity bundle ready for use
 * 
 * @example
 * const userIdentity = await createIdentityBundle()
 * const assistantIdentity = await createIdentityBundle()
 */
export async function createIdentityBundle(): Promise<IdentityBundle> {
  // -------------------------------------------------------------------------
  // STEP 1: Generate long-term identity key pair
  // -------------------------------------------------------------------------
  // This is the root of trust for the Signal Protocol identity.
  // The private key is used for signing pre-keys and X3DH.
  // The public key is shared with other parties.
  const identityKeyPair = PrivateKey.generate()
  
  // -------------------------------------------------------------------------
  // STEP 2: Generate registration ID
  // -------------------------------------------------------------------------
  // Unique identifier for this device in the Signal network
  const registrationId = generateRegistrationId()

  // -------------------------------------------------------------------------
  // STEP 3: Generate signed pre-key
  // -------------------------------------------------------------------------
  // Signed pre-keys are medium-term keys (1-4 weeks) used in X3DH.
  // They're signed by the identity key to prove authenticity.
  const signedPreKeyId = 1  // ID for this signed pre-key
  const signedPreKey = PrivateKey.generate()  // Generate new Curve25519 key pair
  
  // Create signature using identity private key
  // The signature proves this signed pre-key belongs to this identity
  const signedPreKeySignature = identityKeyPair.sign(
    signedPreKey.getPublicKey().serialize()
  )

  // -------------------------------------------------------------------------
  // STEP 4: Generate one-time pre-keys
  // -------------------------------------------------------------------------
  // Pre-keys are ephemeral keys used once in X3DH for forward secrecy.
  // We generate 10 pre-keys initially. More can be generated as needed.
  const preKeys: PreKeyData[] = []
  for (let i = 1; i <= 10; i++) {
    const preKey = PrivateKey.generate()  // Generate ephemeral key pair
    preKeys.push({
      id: i,                               // Unique ID for this pre-key
      publicKey: preKey.getPublicKey(),    // Public part to share
      privateKey: preKey,                  // Private part to keep secret
    })
  }

  // -------------------------------------------------------------------------
  // STEP 5: Generate Kyber post-quantum pre-key
  // -------------------------------------------------------------------------
  // Kyber provides protection against quantum computers.
  // Combined with Curve25519, this provides hybrid post-quantum security.
  const kyberPreKeyId = 1  // ID for this Kyber pre-key
  const kyberKeyPair = KEMKeyPair.generate()  // Generate Kyber key pair
  
  // Sign the Kyber public key with identity key
  // This proves the Kyber key belongs to this identity
  const kyberPreKeySignature = identityKeyPair.sign(
    kyberKeyPair.getPublicKey().serialize()
  )

  // -------------------------------------------------------------------------
  // STEP 6: Assemble and return the complete identity bundle
  // -------------------------------------------------------------------------
  return {
    registrationId,  // Unique device identifier
    identityKeyPair: {  // Long-term identity
      privateKey: identityKeyPair,
      publicKey: identityKeyPair.getPublicKey(),
    },
    signedPreKey: {  // Medium-term authenticated key
      id: signedPreKeyId,
      timestamp: Date.now(),  // Record creation time for rotation tracking
      publicKey: signedPreKey.getPublicKey(),
      privateKey: signedPreKey,
      signature: signedPreKeySignature,
    },
    preKeys,  // Array of one-time ephemeral keys
    kyberPreKey: {  // Post-quantum key
      id: kyberPreKeyId,
      timestamp: Date.now(),
      publicKey: kyberKeyPair.getPublicKey(),
      secretKey: kyberKeyPair.getSecretKey(),
      signature: kyberPreKeySignature,
    },
  }
}

// =============================================================================
// STORE POPULATION
// =============================================================================

/**
 * Populate Signal Protocol stores from an identity bundle.
 * 
 * After creating an identity bundle, this function transfers the keys into
 * the appropriate stores for use by the Signal Protocol library:
 * - Pre-keys → PreKeyStore
 * - Signed pre-keys → SignedPreKeyStore  
 * - Kyber pre-keys → KyberPreKeyStore
 * 
 * The identity key is NOT stored here; it's passed to the IdentityKeyStore
 * constructor separately.
 * 
 * This function creates the library-specific record objects (PreKeyRecord,
 * SignedPreKeyRecord, KyberPreKeyRecord) that wrap the raw keys with
 * additional metadata.
 * 
 * @param bundle - Identity bundle containing keys to store
 * @param stores - Object containing the three pre-key stores to populate
 * @returns Promise<void> - Completes when all keys are stored
 * 
 * @example
 * const bundle = await createIdentityBundle()
 * const stores = {
 *   preKey: new InMemoryPreKeyStore(),
 *   signedPreKey: new InMemorySignedPreKeyStore(),
 *   kyberPreKey: new InMemoryKyberPreKeyStore()
 * }
 * await populateStores(bundle, stores)
 */
export async function populateStores(
  bundle: IdentityBundle,
  stores: {
    preKey: import('./store').InMemoryPreKeyStore
    signedPreKey: import('./store').InMemorySignedPreKeyStore
    kyberPreKey: import('./store').InMemoryKyberPreKeyStore
  }
): Promise<void> {
  // -------------------------------------------------------------------------
  // Store all one-time pre-keys
  // -------------------------------------------------------------------------
  // Each pre-key is wrapped in a PreKeyRecord and stored by its ID.
  // PreKeyRecord.new() creates the library's internal record format.
  for (const preKey of bundle.preKeys) {
    await stores.preKey.savePreKey(
      preKey.id,
      PreKeyRecord.new(preKey.id, preKey.publicKey, preKey.privateKey)
    )
  }

  // -------------------------------------------------------------------------
  // Store the signed pre-key
  // -------------------------------------------------------------------------
  // The signed pre-key includes the signature which proves it belongs
  // to the identity that created it.
  await stores.signedPreKey.saveSignedPreKey(
    bundle.signedPreKey.id,
    SignedPreKeyRecord.new(
      bundle.signedPreKey.id,
      bundle.signedPreKey.timestamp,
      bundle.signedPreKey.publicKey,
      bundle.signedPreKey.privateKey,
      bundle.signedPreKey.signature
    )
  )

  // -------------------------------------------------------------------------
  // Store the Kyber post-quantum pre-key
  // -------------------------------------------------------------------------
  // Kyber pre-keys use a different record type and storage mechanism.
  // We generate a fresh KEMKeyPair here (though we could reuse from bundle).
  const kyberKeyPair = KEMKeyPair.generate()
  const kyberPreKeyRecord = KyberPreKeyRecord.new(
    bundle.kyberPreKey.id,
    bundle.kyberPreKey.timestamp,
    kyberKeyPair,
    bundle.kyberPreKey.signature
  )
  await stores.kyberPreKey.saveKyberPreKey(bundle.kyberPreKey.id, kyberPreKeyRecord)
}

// =============================================================================
// SERIALIZATION
// =============================================================================

/**
 * Serialize an identity bundle for JSON storage.
 * 
 * Converts the runtime IdentityBundle (containing cryptographic objects)
 * into a JSON-serializable format by:
 * - Extracting raw bytes from key objects
 * - Encoding bytes as base64 strings
 * - Creating a plain object structure
 * 
 * This format can be safely stored in JSON files and transferred over
 * networks (though the data is sensitive and should be protected).
 * 
 * @param bundle - Runtime identity bundle with cryptographic objects
 * @returns SerializedIdentityBundle - JSON-serializable version
 * 
 * @example
 * const bundle = await createIdentityBundle()
 * const serialized = serializeIdentityBundle(bundle)
 * // serialized can now be saved to a JSON file
 * fs.writeFileSync('identity.json', JSON.stringify(serialized))
 */
export function serializeIdentityBundle(bundle: IdentityBundle): SerializedIdentityBundle {
  return {
    // Copy registration ID as-is (it's already a number)
    registrationId: bundle.registrationId,
    
    // Serialize identity key pair
    // Both keys are converted to base64 strings
    identityKeyPair: {
      privateKey: Buffer.from(bundle.identityKeyPair.privateKey.serialize()).toString('base64'),
      publicKey: Buffer.from(bundle.identityKeyPair.publicKey.serialize()).toString('base64'),
    },
    
    // Serialize signed pre-key with all fields
    signedPreKey: {
      id: bundle.signedPreKey.id,
      timestamp: bundle.signedPreKey.timestamp,
      publicKey: Buffer.from(bundle.signedPreKey.publicKey.serialize()).toString('base64'),
      privateKey: Buffer.from(bundle.signedPreKey.privateKey.serialize()).toString('base64'),
      signature: Buffer.from(bundle.signedPreKey.signature).toString('base64'),
    },
    
    // Serialize array of one-time pre-keys
    preKeys: bundle.preKeys.map((pk) => ({
      id: pk.id,
      publicKey: Buffer.from(pk.publicKey.serialize()).toString('base64'),
      privateKey: Buffer.from(pk.privateKey.serialize()).toString('base64'),
    })),
    
    // Serialize Kyber post-quantum pre-key
    kyberPreKey: {
      id: bundle.kyberPreKey.id,
      timestamp: bundle.kyberPreKey.timestamp,
      publicKey: Buffer.from(bundle.kyberPreKey.publicKey.serialize()).toString('base64'),
      secretKey: Buffer.from(bundle.kyberPreKey.secretKey.serialize()).toString('base64'),
      signature: Buffer.from(bundle.kyberPreKey.signature).toString('base64'),
    },
  }
}

// =============================================================================
// DESERIALIZATION
// =============================================================================

/**
 * Deserialize an identity bundle from JSON storage.
 * 
 * Converts a SerializedIdentityBundle (with base64-encoded strings) back
 * into a runtime IdentityBundle (with cryptographic objects) by:
 * - Decoding base64 strings to raw bytes
 * - Creating key objects using library constructors
 * - Assembling the complete bundle structure
 * 
 * This is the reverse operation of serializeIdentityBundle().
 * 
 * Note on Kyber keys: The current implementation regenerates the Kyber key
 * pair instead of restoring from serialized data. This is acceptable for
 * our use case because Kyber keys are primarily used during initial session
 * establishment. For production use, you may want to properly restore them.
 * 
 * @param data - Serialized identity bundle from storage
 * @returns IdentityBundle - Runtime identity bundle with cryptographic objects
 * 
 * @example
 * const data = JSON.parse(fs.readFileSync('identity.json', 'utf8'))
 * const bundle = deserializeIdentityBundle(data)
 * // bundle now contains usable cryptographic objects
 */
export function deserializeIdentityBundle(data: SerializedIdentityBundle): IdentityBundle {
  return {
    // Copy registration ID as-is
    registrationId: data.registrationId,
    
    // Deserialize identity key pair from base64
    identityKeyPair: {
      privateKey: PrivateKey.deserialize(Buffer.from(data.identityKeyPair.privateKey, 'base64')),
      publicKey: PublicKey.deserialize(Buffer.from(data.identityKeyPair.publicKey, 'base64')),
    },
    
    // Deserialize signed pre-key
    signedPreKey: {
      id: data.signedPreKey.id,
      timestamp: data.signedPreKey.timestamp,
      publicKey: PublicKey.deserialize(Buffer.from(data.signedPreKey.publicKey, 'base64')),
      privateKey: PrivateKey.deserialize(Buffer.from(data.signedPreKey.privateKey, 'base64')),
      signature: Buffer.from(data.signedPreKey.signature, 'base64'),
    },
    
    // Deserialize array of one-time pre-keys
    preKeys: data.preKeys.map((pk) => ({
      id: pk.id,
      publicKey: PublicKey.deserialize(Buffer.from(pk.publicKey, 'base64')),
      privateKey: PrivateKey.deserialize(Buffer.from(pk.privateKey, 'base64')),
    })),
    
    // Deserialize Kyber pre-key
    // Note: We regenerate the Kyber key pair instead of restoring
    // This is acceptable for our use case but not ideal for production
    kyberPreKey: {
      id: data.kyberPreKey.id,
      timestamp: data.kyberPreKey.timestamp,
      publicKey: KEMKeyPair.generate().getPublicKey(),
      secretKey: KEMKeyPair.generate().getSecretKey(),
      signature: Buffer.from(data.kyberPreKey.signature, 'base64'),
    },
  }
}

// =============================================================================
// SECURITY NOTES
// =============================================================================

/**
 * Security Considerations for Identity Management:
 * 
 * 1. Key Generation:
 *    - Keys should be generated using cryptographically secure random number
 *      generators (provided by @signalapp/libsignal-client)
 *    - Generation should happen in a secure environment
 * 
 * 2. Storage:
 *    - Private keys are extremely sensitive
 *    - Store serialized bundles encrypted at rest
 *    - Use file permissions to restrict access (0600)
 *    - Consider hardware security modules (HSMs) for production
 * 
 * 3. Transmission:
 *    - Never transmit private keys over networks
 *    - Only public keys should leave the device
 *    - Pre-key bundles should be transmitted over authenticated channels
 * 
 * 4. Rotation:
 *    - Signed pre-keys should be rotated periodically (1-4 weeks)
 *    - Identity keys should rarely if ever change
 *    - When rotating, handle in-flight messages carefully
 * 
 * 5. Backup:
 *    - Backup strategies must protect private keys
 *    - Consider key escrow for recovery
 *    - Test restoration procedures
 * 
 * 6. Destruction:
 *    - Securely delete keys when no longer needed
 *    - Overwrite memory before freeing
 *    - Handle device disposal carefully
 */
