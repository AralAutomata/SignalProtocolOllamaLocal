/**
 * Message List Component
 * 
 * This component renders the scrollable list of chat messages.
 * It handles:
 * - Displaying only the most recent messages (viewport optimization)
 * - Showing an indicator when older messages are hidden
 * - Passing width constraints to child MessageItem components
 * 
 * The component uses virtualization principles by only rendering visible
 * messages, which improves performance with long chat histories.
 * 
 * Performance Optimizations:
 * - useMemo to avoid recalculating visible messages on every render
 * - React.memo to prevent re-rendering when props haven't changed
 * - Memoized MessageItem components to prevent child re-renders
 */

import React, { memo, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ChatMessage } from '../types'
import { MessageItem } from './message-item'

// =============================================================================
// PROPS INTERFACE
// =============================================================================

/**
 * Props for the MessageList component.
 * 
 * @property messages - Array of chat messages to display
 * @property maxWidth - Maximum width available for rendering (for text wrapping)
 */
interface MessageListProps {
  /** Array of decrypted chat messages */
  messages: ChatMessage[]
  /** Maximum width in characters for message content */
  maxWidth: number
}

// =============================================================================
// MEMOIZED CHILD COMPONENT
// =============================================================================

/**
 * Memoized version of MessageItem for performance.
 * 
 * Prevents MessageItem from re-rendering unless its props actually change.
 * This is crucial for performance with long message lists.
 */
const MemoizedMessageItem = memo(MessageItem)

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Renders a scrollable list of chat messages with viewport optimization.
 * 
 * This component implements a simple form of virtualization:
 * - Only renders the most recent N messages that fit on screen
 * - Shows an indicator when older messages are hidden above
 * - Passes width constraints down for proper text wrapping
 * 
 * The viewport calculation considers terminal height to ensure we don't
 * render more messages than can be displayed, improving performance.
 * 
 * @param messages - Array of ChatMessage objects to display
 * @param maxWidth - Maximum width for content (accounting for sidebar)
 */
export const MessageList = memo(function MessageList({ messages, maxWidth }: MessageListProps) {
  // Get terminal dimensions for viewport calculation
  const { stdout } = useStdout()
  const terminalHeight = stdout.rows || 24
  
  // Calculate how many messages to show based on terminal height
  // Reserve 8 lines for: status bar (3) + prompt (1) + margins/padding (4)
  // Show at least 5 messages even on small terminals
  const maxVisibleMessages = Math.max(5, terminalHeight - 8)

  // Memoize visible messages to avoid recalculation on every render
  // Only recalculate when messages array or maxVisibleMessages changes
  const visibleMessages = useMemo(() => {
    // Slice from the end to get most recent messages
    // This creates the "scroll" effect - old messages scroll off the top
    return messages.slice(-maxVisibleMessages)
  }, [messages, maxVisibleMessages])

  // Determine if we have hidden older messages
  const hasMoreMessages = messages.length > maxVisibleMessages
  // Calculate how many messages are hidden (for the indicator text)
  const hiddenCount = messages.length - maxVisibleMessages

  // Render the message list
  return (
    <Box flexDirection="column" width={maxWidth}>
      {/* Show indicator when older messages are hidden above the viewport */}
      {hasMoreMessages && (
        <Text color="gray" dimColor>
          ... {hiddenCount} earlier messages ...
        </Text>
      )}
      
      {/* Render visible messages */}
      {visibleMessages.map((message) => (
        <MemoizedMessageItem 
          key={message.id}  // React key for list rendering optimization
          message={message}
          maxWidth={maxWidth}  // Pass width constraint for wrapping
        />
      ))}
    </Box>
  )
})
