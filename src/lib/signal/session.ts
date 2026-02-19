/**
 * Signal Protocol Session Management
 * 
 * This module provides high-level functions for:
 * 1. Establishing encrypted sessions between two parties
 * 2. Encrypting messages using the Double Ratchet algorithm
 * 3. Decrypting messages with automatic key management
 * 
 * The Signal Protocol provides end-to-end encryption with:
 * - Perfect forward secrecy (old keys can't decrypt future messages)
 * - Future secrecy (compromised keys don't reveal past messages)
 * - Post-quantum resistance (via Kyber hybrid encryption)
 * - Authentication (via X3DH and identity keys)
 * 
 * This module abstracts the low-level Signal library operations into
 * easy-to-use functions for the chat application.
 */

// =============================================================================
// EXTERNAL IMPORTS
// =============================================================================

import {
  ProtocolAddress,           // Identifies a Signal user (name + device ID)
  PreKeyBundle,              // Complete set of pre-keys for X3DH
  signalEncrypt,             // Encrypt a message using Double Ratchet
  signalDecrypt,             // Decrypt a regular Signal message
  signalDecryptPreKey,       // Decrypt initial X3DH PreKey message
  processPreKeyBundle,       // Process remote pre-keys and establish session
  CiphertextMessage,         // Base type for encrypted messages
  PreKeySignalMessage,       // Initial X3DH encrypted message
  SignalMessage,             // Regular Double Ratchet encrypted message
  CiphertextMessageType,     // Enum: PreKey or SignalMessage
} from '@signalapp/libsignal-client'

import type { IdentityBundle } from './types'  // Identity key bundle type
import type { SignalStores } from './store'    // Collection of all stores

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Result of encrypting a message.
 * 
 * Contains the encrypted ciphertext and the message type, both needed
 * for proper decryption on the receiving end.
 * 
 * @property ciphertext - The encrypted message bytes
 * @property messageType - Type indicating initial or ratchet message
 */
export interface EncryptionResult {
  /** Encrypted message content as bytes */
  ciphertext: Uint8Array
  /** 
   * Type of encrypted message
   * - PreKey (1): First message in a session (includes pre-key info)
   * - SignalMessage (2): Subsequent messages (Double Ratchet)
   */
  messageType: CiphertextMessageType
}

// =============================================================================
// SESSION ESTABLISHMENT
// =============================================================================

/**
 * Establish a bidirectional encrypted session between user and assistant.
 * 
 * This function performs the X3DH (Extended Triple Diffie-Hellman) key
 * agreement to establish initial shared secrets, then initializes the
 * Double Ratchet for both parties.
 * 
 * How it works:
 * 1. Create ProtocolAddresses for both parties (user and assistant)
 * 2. Build PreKeyBundles containing all public keys
 * 3. Process each party's pre-keys from the other's perspective
 * 4. This creates the initial session state in both direction
 * 
 * Why bidirectional?
 * In typical Signal usage, Alice initiates to Bob. Bob processes Alice's
 * pre-keys when he receives her first message. But for our two-party chat,
 * we need sessions established in BOTH directions immediately so either
 * party can send the first message.
 * 
 * @param userIdentity - Complete identity bundle for the human user
 * @param assistantIdentity - Complete identity bundle for the AI assistant
 * @param userStores - Signal stores for the user (will be populated with session)
 * @param assistantStores - Signal stores for the assistant (will be populated with session)
 * @returns Promise<void> - Completes when sessions are established in both directions
 * 
 * @example
 * const userIdentity = await createIdentityBundle()
 * const assistantIdentity = await createIdentityBundle()
 * await establishSession(userIdentity, assistantIdentity, userStores, assistantStores)
 * // Both parties can now encrypt/decrypt messages
 */
export async function establishSession(
  userIdentity: IdentityBundle,
  assistantIdentity: IdentityBundle,
  userStores: SignalStores,
  assistantStores: SignalStores
): Promise<void> {
  // -------------------------------------------------------------------------
  // STEP 1: Create protocol addresses
  // -------------------------------------------------------------------------
  // ProtocolAddress identifies a specific user/device combination.
  // Format: name + deviceId (we use 1 for single-device model)
  const userAddress = ProtocolAddress.new('user', 1)
  const assistantAddress = ProtocolAddress.new('assistant', 1)

  // -------------------------------------------------------------------------
  // STEP 2: Build PreKeyBundles
  // -------------------------------------------------------------------------
  // PreKeyBundle contains all public keys needed for X3DH.
  // It's like a "business card" with cryptographic information.
  
  // Build user's pre-key bundle
  const userPreKeyBundle = PreKeyBundle.new(
    userIdentity.registrationId,           // User's registration ID
    1,                                      // Device ID
    userIdentity.preKeys[0].id,            // One-time pre-key ID
    userIdentity.preKeys[0].publicKey,     // One-time pre-key public
    userIdentity.signedPreKey.id,          // Signed pre-key ID
    userIdentity.signedPreKey.publicKey,   // Signed pre-key public
    userIdentity.signedPreKey.signature,   // Signature of signed pre-key
    userIdentity.identityKeyPair.publicKey, // Long-term identity key
    userIdentity.kyberPreKey.id,           // Kyber post-quantum pre-key ID
    userIdentity.kyberPreKey.publicKey,    // Kyber public key
    userIdentity.kyberPreKey.signature     // Kyber key signature
  )

  // Build assistant's pre-key bundle
  const assistantPreKeyBundle = PreKeyBundle.new(
    assistantIdentity.registrationId,
    1,
    assistantIdentity.preKeys[0].id,
    assistantIdentity.preKeys[0].publicKey,
    assistantIdentity.signedPreKey.id,
    assistantIdentity.signedPreKey.publicKey,
    assistantIdentity.signedPreKey.signature,
    assistantIdentity.identityKeyPair.publicKey,
    assistantIdentity.kyberPreKey.id,
    assistantIdentity.kyberPreKey.publicKey,
    assistantIdentity.kyberPreKey.signature
  )

  // -------------------------------------------------------------------------
  // STEP 3: Process pre-key bundles bidirectionally
  // -------------------------------------------------------------------------
  // User processes assistant's pre-keys (creates session from user to assistant)
  await processPreKeyBundle(
    assistantPreKeyBundle,     // The remote party's public keys
    assistantAddress,          // Address identifying the remote party
    userStores.session,        // Where to store the new session
    userStores.identity        // User's identity store for authentication
  )

  // Assistant processes user's pre-keys (creates session from assistant to user)
  await processPreKeyBundle(
    userPreKeyBundle,
    userAddress,
    assistantStores.session,
    assistantStores.identity
  )
  
  // At this point:
  // - User can encrypt messages to assistant
  // - Assistant can encrypt messages to user
  // - Both can decrypt messages from each other
  // - Double Ratchet is initialized and ready
}

// =============================================================================
// MESSAGE ENCRYPTION
// =============================================================================

/**
 * Encrypt a plaintext message for a recipient.
 * 
 * This function uses the Signal Protocol's Double Ratchet algorithm to
 * encrypt a message. It automatically:
 * 1. Advances the sending chain of the ratchet
 * 2. Derives a new message key
 * 3. Encrypts the plaintext with AES-256-CBC
 * 4. Authenticates with HMAC-SHA256
 * 5. Updates the session state
 * 
 * The Double Ratchet provides:
 * - Self-healing: Each message uses a new key
 * - Out-of-order handling: Messages can arrive in any order
 * - Message keys are ephemeral (can't decrypt other messages)
 * 
 * @param plaintext - The text message to encrypt
 * @param recipientName - Name of the recipient ('user' or 'assistant')
 * @param stores - Signal stores for the sender
 * @returns Promise<EncryptionResult> - Encrypted message and type
 * 
 * @example
 * // User sends message to assistant
 * const result = await encryptMessage('Hello!', 'assistant', userStores)
 * // Store result.ciphertext and result.messageType for transmission
 */
export async function encryptMessage(
  plaintext: string,
  recipientName: string,
  stores: SignalStores
): Promise<EncryptionResult> {
  // Create protocol address for the recipient
  // Format: name + deviceId (we use 1)
  const address = ProtocolAddress.new(recipientName, 1)
  
  // Convert plaintext string to bytes (UTF-8 encoding)
  const messageBytes = new TextEncoder().encode(plaintext)

  // Perform the encryption using Signal Protocol
  // This function handles all Double Ratchet operations:
  // - Advances ratchet if needed
  // - Derives message key
  // - Encrypts with AES-256-CBC
  // - Authenticates with HMAC-SHA256
  const ciphertext = await signalEncrypt(
    messageBytes,
    address,
    stores.session,     // Session store (ratchet state)
    stores.identity     // Identity store (for authentication)
  )

  // Return both the encrypted bytes and the message type
  // The type tells the receiver which decryption function to use
  return {
    ciphertext: ciphertext.serialize(),  // Convert to bytes for storage/transmission
    messageType: ciphertext.type(),      // PreKey or SignalMessage
  }
}

// =============================================================================
// MESSAGE DECRYPTION
// =============================================================================

/**
 * Decrypt an encrypted message from a sender.
 * 
 * This function handles both types of Signal Protocol messages:
 * 1. PreKeySignalMessage - Initial message in a session (X3DH)
  * 2. SignalMessage - Regular message (Double Ratchet)
 * 
 * The decryption process:
 * 1. Determine message type (PreKey or regular)
 * 2. Deserialize the appropriate message format
 * 3. Decrypt using the corresponding function
 * 4. Update session state (ratchet advancement)
 * 5. Return the plaintext
 * 
 * Error handling:
 * - Throws if message is corrupted or tampered with
 * - Throws if we don't have the necessary keys
 * - Throws if the session state is inconsistent
 * 
 * @param ciphertext - The encrypted message bytes
 * @param messageType - Type of message (PreKey or SignalMessage)
 * @param senderName - Name of the sender ('user' or 'assistant')
 * @param stores - Signal stores for the receiver
 * @returns Promise<string> - The decrypted plaintext message
 * @throws Error if decryption fails (corrupted message, wrong keys, etc.)
 * 
 * @example
 * // Decrypt message from user
 * const plaintext = await decryptMessage(
 *   encryptedData,
 *   CiphertextMessageType.SignalMessage,
 *   'user',
 *   assistantStores
 * )
 * console.log(plaintext) // "Hello!"
 */
export async function decryptMessage(
  ciphertext: Uint8Array,
  messageType: CiphertextMessageType,
  senderName: string,
  stores: SignalStores
): Promise<string> {
  // Create protocol address for the sender
  const address = ProtocolAddress.new(senderName, 1)

  // Variable to hold the decrypted plaintext bytes
  let plaintext: Uint8Array

  // -------------------------------------------------------------------------
  // Determine message type and decrypt accordingly
  // -------------------------------------------------------------------------
  if (messageType === CiphertextMessageType.PreKey) {
    // -----------------------------------------------------------------------
    // PRE-KEY MESSAGE (Initial X3DH handshake message)
    // -----------------------------------------------------------------------
    // This is the first message in a session. It includes:
    // - Pre-key information for X3DH
    // - Encrypted content
    // - Authentication data
    
    // Deserialize the PreKeySignalMessage from bytes
    const preKeyMessage = PreKeySignalMessage.deserialize(ciphertext)
    
    // Decrypt using the special PreKey decryption function
    // This performs X3DH key agreement and initializes the ratchet
    plaintext = await signalDecryptPreKey(
      preKeyMessage,
      address,
      stores.session,      // Session store (will be initialized)
      stores.identity,     // Identity store (for authentication)
      stores.preKey,       // Pre-key store (to consume one-time pre-key)
      stores.signedPreKey, // Signed pre-key store
      stores.kyberPreKey   // Kyber pre-key store (post-quantum)
    )
  } else {
    // -----------------------------------------------------------------------
    // SIGNAL MESSAGE (Regular Double Ratchet message)
    // -----------------------------------------------------------------------
    // This is a subsequent message in an established session.
    // Uses the Double Ratchet for decryption.
    
    // Deserialize the SignalMessage from bytes
    const signalMessage = SignalMessage.deserialize(ciphertext)
    
    // Decrypt using the standard Signal decryption function
    // This advances the ratchet and derives the message key
    plaintext = await signalDecrypt(
      signalMessage,
      address,
      stores.session,   // Session store (ratchet state)
      stores.identity   // Identity store (for authentication)
    )
  }

  // Convert decrypted bytes back to a string (UTF-8 decoding)
  return new TextDecoder().decode(plaintext)
}

// =============================================================================
// SECURITY NOTES
// =============================================================================

/**
 * Security Properties of the Signal Protocol Implementation:
 * 
 * 1. Forward Secrecy (Past Secrecy):
 *    - Compromising long-term keys doesn't reveal past messages
 *    - Each message uses a unique ephemeral key
 *    - Old message keys are deleted after use
 * 
 * 2. Future Secrecy (Self-Healing):
 *    - If current keys are compromised, future messages are still secure
 *    - The ratchet continuously generates new keys
 *    - An attacker can't decrypt future messages with current keys
 * 
 * 3. Integrity:
 *    - All messages are authenticated with HMAC-SHA256
 *    - Tampered messages are detected and rejected
 *    - Message order can be verified (though out-of-order is handled)
 * 
 * 4. Post-Quantum Security:
 *    - Kyber-1024 provides quantum-resistant key exchange
 *    - Hybrid approach: both classical and post-quantum must be broken
 *    - Protection against "harvest now, decrypt later" attacks
 * 
 * 5. Authentication:
 *    - X3DH provides mutual authentication
 *    - Identity keys are long-term and verified
 *    - Pre-keys are signed by identity keys
 * 
 * 6. Deniability:
 *    - Messages could theoretically be forged by either party
 *    - Provides plausible deniability in some contexts
 *    - More relevant for group chats than two-party
 * 
 * Limitations of This Implementation:
 * 
 * 1. Single-Device Model:
 *    - Only supports one device per user
 *    - Real Signal supports multi-device
 * 
 * 2. No Key Rotation:
 *    - Signed pre-keys are not rotated periodically
 *    - In production, should rotate every 1-4 weeks
 * 
 * 3. No Message Delivery Guarantees:
 *    - This is an application-level concern
 *    - Signal Protocol handles encryption, not transport
 * 
 * 4. Trust on First Use (TOFU):
 *    - First contact is trusted without verification
 *    - Real Signal allows safety number verification
 */
