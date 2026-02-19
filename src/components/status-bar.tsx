/**
 * Status Bar Component
 * 
 * Displays the top status bar showing:
 * - Current Ollama model name
 * - Total message count
 * - Session age (how long since session started)
 * - Keyboard shortcuts (Ctrl+R, Ctrl+C)
 * 
 * The status bar uses a bordered box with blue accents to match
 * the application's color scheme. It provides at-a-glance information
 * about the current chat session.
 * 
 * Performance: Uses memo to prevent re-renders when props haven't changed.
 * The age is calculated once on render (not updated live) to prevent flickering.
 */

import React, { memo } from 'react'
import { Box, Text } from 'ink'

// =============================================================================
// PROPS INTERFACE
// =============================================================================

/**
 * Props for the StatusBar component.
 * 
 * @property model - Name of the Ollama model being used
 * @property messageCount - Total number of messages in the session
 * @property sessionAge - Unix timestamp when session was created (optional)
 */
interface StatusBarProps {
  /** Name of the Ollama model (e.g., 'llama3.2', 'qwen2.5') */
  model: string
  /** Total number of messages sent/received in this session */
  messageCount: number
  /** Session creation timestamp (optional, for age calculation) */
  sessionAge?: number
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Renders the top status bar with session information.
 * 
 * Layout:
 * - Left side: Model name, message count, session age
 * - Right side: Keyboard shortcuts
 * - Full width with border
 * 
 * Design decisions:
 * - Age is calculated once (not a live timer) to prevent screen flickering
 * - Uses blue color scheme for consistency
 * - Keyboard shortcuts always visible for discoverability
 * 
 * @param model - Ollama model name
 * @param messageCount - Number of messages
 * @param sessionAge - Session creation timestamp
 */
export const StatusBar = memo(function StatusBar({ model, messageCount, sessionAge }: StatusBarProps) {
  // Calculate session age display string
  // Note: Calculated once on render, not a live countdown (prevents flickering)
  const ageDisplay = sessionAge
    ? ` | Session: ${formatAge(sessionAge)}`
    : ''

  return (
    <Box
      borderStyle="single"      // Single-line border
      borderColor="blue"        // Blue border color
      paddingX={1}              // Horizontal padding inside border
      justifyContent="space-between"  // Push content to left and right edges
    >
      {/* Left side: Session info */}
      <Box>
        {/* Model label and value */}
        <Text bold color="blue">
          Model:
        </Text>
        <Text>{' '}{model}</Text>
        
        {/* Separator */}
        <Text color="gray">{' | '}</Text>
        
        {/* Message count */}
        <Text bold color="blue">
          Messages:
        </Text>
        <Text>{' '}{messageCount}</Text>
        
        {/* Session age (if available) */}
        <Text color="gray">{ageDisplay}</Text>
      </Box>
      
      {/* Right side: Keyboard shortcuts */}
      <Box>
        <Text dimColor color="gray">
          Ctrl+R: Reset | Ctrl+C: Exit
        </Text>
      </Box>
    </Box>
  )
})

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format a timestamp into a human-readable age string.
 * 
 * Converts a Unix timestamp into a relative time string:
 * - < 60 seconds: "Xs" (e.g., "45s")
 * - < 60 minutes: "Xm" (e.g., "23m")
 * - >= 60 minutes: "Xh" (e.g., "2h")
 * 
 * @param timestamp - Unix timestamp (milliseconds) to format
 * @returns string - Formatted age string
 * 
 * @example
 * formatAge(Date.now() - 45000)  // Returns "45s"
 * formatAge(Date.now() - 120000) // Returns "2m"
 * formatAge(Date.now() - 7200000) // Returns "2h"
 */
function formatAge(timestamp: number): string {
  // Calculate seconds elapsed since timestamp
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  
  // Less than a minute: show seconds
  if (seconds < 60) return `${seconds}s`
  
  // Less than an hour: show minutes
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  
  // An hour or more: show hours
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}
