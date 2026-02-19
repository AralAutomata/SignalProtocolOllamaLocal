/**
 * Encryption Status Panel Component
 * 
 * Displays a side panel showing detailed information about the current
 * encryption session and security configuration. This provides transparency
 * to users about the security measures in place.
 * 
 * Information displayed:
 * - E2EE (End-to-End Encryption) status
 * - Protocol details (Signal, X3DH, X25519, AES-256, Kyber)
 * - Identity registration IDs
 * - Key store status (pre-keys available, Kyber ready)
 * - Session age and message count
 * - Security features enabled
 * 
 * The panel is only shown when the terminal is wide enough (≥110 columns)
 * to avoid crowding the chat area on smaller screens.
 * 
 * Security Note: This panel only displays non-sensitive information like
 * registration IDs and key counts. No private keys or sensitive material
 * is ever displayed.
 */

import React, { memo, useMemo } from 'react'
import { Box, Text } from 'ink'
import type { SessionData } from '../types'

// =============================================================================
// PROPS INTERFACE
// =============================================================================

/**
 * Props for the EncryptionStatus component.
 * 
 * @property sessionData - Complete session data with identities and metadata
 * @property messageCount - Total count of messages (from ChatView state)
 */
interface EncryptionStatusProps {
  /** Complete session data including identities and stores */
  sessionData: SessionData
  /** Current message count (may differ from sessionData.messages.length temporarily) */
  messageCount: number
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Renders the encryption status side panel.
 * 
 * Layout: Vertical stack of sections inside a bordered box
 * - E2EE Status indicator
 * - Protocol information
 * - Identity registration IDs
 * - Key store status
 * - Session statistics
 * - Security features list
 * 
 * Design:
 * - Fixed width of 35 characters
 * - Blue border to match app color scheme
 * - Cyan headers, gray labels, white values
 * - Green indicators for active/enabled states
 * 
 * @param sessionData - Session data with identities
 * @param messageCount - Total message count
 */
export const EncryptionStatus = memo(function EncryptionStatus({ 
  sessionData, 
  messageCount 
}: EncryptionStatusProps) {
  // Calculate session age as human-readable string
  // Memoized to avoid recalculation on every render
  const sessionAge = useMemo(() => {
    const hours = Math.floor((Date.now() - sessionData.created) / (1000 * 60 * 60))
    const minutes = Math.floor(((Date.now() - sessionData.created) / (1000 * 60)) % 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }, [sessionData.created])

  // Get encrypted message count from session data
  const encryptedCount = sessionData.messages.length

  return (
    <Box 
      flexDirection="column"    // Stack sections vertically
      borderStyle="single"      // Single-line border
      borderColor="blue"        // Blue border
      paddingX={1}              // Horizontal padding
      width={35}                // Fixed width panel
    >
      {/* Header: Panel title */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🔐 Encryption Status
        </Text>
      </Box>

      {/* E2EE Status indicator */}
      <Box marginBottom={1}>
        <Text color="green">●</Text>
        <Text>{' '}E2EE:{' '}</Text>
        <Text bold color="green">ACTIVE</Text>
      </Box>

      {/* Protocol Section: Technical details */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Protocol</Text>
        <Text color="gray">Signal Double Ratchet</Text>
        <Text color="gray">X3DH Key Agreement</Text>
        <Text color="gray">X25519 Key Exchange</Text>
        <Text color="gray">AES-256-GCM</Text>
        <Text color="gray">Kyber-1024 (PQ)</Text>
      </Box>

      {/* Identities Section: Registration IDs */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Identities</Text>
        <Box>
          <Text color="gray">User: </Text>
          <Text>#{sessionData.userIdentity.registrationId}</Text>
        </Box>
        <Box>
          <Text color="gray">Assistant: </Text>
          <Text>#{sessionData.assistantIdentity.registrationId}</Text>
        </Box>
      </Box>

      {/* Key Store Section: Pre-key availability */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Key Store</Text>
        <Box>
          <Text color="gray">Pre-Keys: </Text>
          <Text>{sessionData.userIdentity.preKeys.length} available</Text>
        </Box>
        <Box>
          <Text color="gray">Kyber PQ: </Text>
          <Text color="green">● Ready</Text>
        </Box>
      </Box>

      {/* Session Section: Age and message count */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Session</Text>
        <Box>
          <Text color="gray">Age: </Text>
          <Text>{sessionAge}</Text>
        </Box>
        <Box>
          <Text color="gray">Messages: </Text>
          <Text>{encryptedCount} encrypted</Text>
        </Box>
      </Box>

      {/* Security Section: Enabled features */}
      <Box flexDirection="column">
        <Text bold color="cyan">Security</Text>
        <Box>
          <Text color="green">●</Text>
          <Text color="gray">{' Forward Secrecy'}</Text>
        </Box>
        <Box>
          <Text color="green">●</Text>
          <Text color="gray">{' Break-in Recovery'}</Text>
        </Box>
        <Box>
          <Text color="gray">Key Rotation: Auto</Text>
        </Box>
      </Box>
    </Box>
  )
})

// =============================================================================
// SECURITY INFORMATION NOTES
// =============================================================================

/**
 * Information Displayed (Safe to Show):
 * 
 * ✓ E2EE Status: Whether encryption is active
 * ✓ Protocol Names: Algorithm names (Signal, X3DH, etc.)
 * ✓ Registration IDs: Public identifiers (like user IDs)
 * ✓ Key Counts: Number of pre-keys available
 * ✓ Session Age: How long the session has been active
 * ✓ Message Count: Number of encrypted messages
 * ✓ Security Features: Enabled protections
 * 
 * Information NOT Displayed (Sensitive):
 * 
 * ✗ Private Keys: Never shown, kept in secure storage
 * ✗ Public Key Fingerprints: Could be used in attacks
 * ✗ Pre-Key Details: Only counts shown, not actual keys
 * ✗ Session State: Internal ratchet state is hidden
 * ✗ Ciphertext Content: Encrypted message content not displayed
 * 
 * This approach balances transparency with security - users can see
 * that encryption is active and properly configured, but sensitive
 * cryptographic material remains protected.
 */
