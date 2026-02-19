/**
 * Message Item Component
 * 
 * This component renders a single chat message with full markdown support,
 * syntax highlighting, and text wrapping. It handles:
 * - Role-based coloring (user=cyan, assistant=green)
 * - Markdown parsing (bold, italic, inline code, code blocks)
 * - Language-specific syntax highlighting
 * - Text wrapping for terminal width
 * - Code blocks with line numbers and language labels
 * 
 * The component uses a sophisticated parsing approach:
 * 1. Parse markdown into typed segments (normal, bold, italic, code, codeblock)
 * 2. Group segments for efficient rendering
 * 3. Wrap text to fit terminal width
 * 4. Render with appropriate Ink components and colors
 */

import React, { useMemo, memo } from 'react'
import { Text, Box } from 'ink'
import type { ChatMessage } from '../types'
import { SyntaxHighlighter, getLanguageTheme } from './syntax-highlighter'

// =============================================================================
// TEXT WRAPPING UTILITY
// =============================================================================

/**
 * Wrap text to fit within a maximum width by breaking at word boundaries.
 * 
 * This implements a simple greedy word-wrapping algorithm:
 * 1. Split text into words
 * 2. Add words to current line until adding another would exceed maxWidth
 * 3. Start a new line when limit reached
 * 4. Handle edge cases (single word longer than maxWidth, empty text)
 * 
 * @param text - The text to wrap
 * @param maxWidth - Maximum line width in characters
 * @returns string[] - Array of wrapped lines
 */
function wrapText(text: string, maxWidth: number): string[] {
  // Edge case: invalid width
  if (maxWidth <= 0) return [text]
  
  const lines: string[] = []
  const words = text.split(' ')
  let currentLine = ''
  
  for (const word of words) {
    // Check if adding this word would exceed the limit
    if ((currentLine + ' ' + word).length <= maxWidth) {
      // Add word to current line (with space if not first word)
      currentLine = currentLine ? currentLine + ' ' + word : word
    } else {
      // Line would be too long, push current line and start new one
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  
  // Don't forget the last line
  if (currentLine) lines.push(currentLine)
  
  // Return wrapped lines, or original text if wrapping failed
  return lines.length > 0 ? lines : [text]
}

// =============================================================================
// MARKDOWN PARSING TYPES
// =============================================================================

/**
 * Represents a segment of parsed markdown content.
 * 
 * The message content is parsed into segments, each with a type that
 * determines how it should be rendered (color, formatting, etc.)
 */
interface TextSegment {
  /** Type of segment determining rendering style */
  type: 'normal' | 'bold' | 'italic' | 'code' | 'codeblock'
  /** The text content of this segment */
  text: string
  /** Programming language for code blocks (undefined for other types) */
  lang?: string
}

// =============================================================================
// MARKDOWN PARSER
// =============================================================================

/**
 * Parse markdown text into typed segments.
 * 
 * This parser scans the text sequentially looking for markdown patterns:
 * - Code blocks: ```language\ncode\n```
 * - Plain code blocks: Language\n  indented code
 * - Inline code: `code`
 * - Bold: **text**
 * - Italic: *text*
 * 
 * It builds segments in order, handling overlapping patterns by finding
 * the earliest match first.
 * 
 * @param text - Raw markdown text to parse
 * @returns TextSegment[] - Array of typed segments
 */
function parseMarkdown(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let remaining = text

  // Regular expressions for markdown patterns
  // Match standard fenced code blocks with optional language
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/
  // Match plain text code blocks (language name followed by indented code)
  const plainCodeBlockRegex = /(?:^|\n)([A-Za-z+#]+)\n((?:  [^\n]*\n*)+)/
  // Match inline code between backticks
  const inlineCodeRegex = /`([^`]+)`/
  // Match bold text between double asterisks
  const boldRegex = /\*\*([^*]+)\*\*/
  // Match italic text between single asterisks
  const italicRegex = /\*([^*]+)\*/

  // Parse loop: find patterns until no more text remains
  while (remaining.length > 0) {
    // Find all pattern matches
    const codeBlockMatch = remaining.match(codeBlockRegex)
    const plainCodeMatch = remaining.match(plainCodeBlockRegex)
    const inlineCodeMatch = remaining.match(inlineCodeRegex)
    const boldMatch = remaining.match(boldRegex)
    const italicMatch = remaining.match(italicRegex)

    // Get positions of matches (Infinity if no match)
    const nextCodeBlock = codeBlockMatch ? codeBlockMatch.index! : Infinity
    const nextPlainCode = plainCodeMatch ? plainCodeMatch.index! : Infinity
    const nextInlineCode = inlineCodeMatch ? inlineCodeMatch.index! : Infinity
    const nextBold = boldMatch ? boldMatch.index! : Infinity
    const nextItalic = italicMatch ? italicMatch.index! : Infinity

    // Find the earliest pattern
    const nextSpecial = Math.min(nextCodeBlock, nextPlainCode, nextInlineCode, nextBold, nextItalic)

    // No more patterns found - rest is normal text
    if (nextSpecial === Infinity) {
      if (remaining.length > 0) {
        segments.push({ type: 'normal', text: remaining })
      }
      break
    }

    // Handle normal text before the next pattern
    if (nextSpecial > 0) {
      segments.push({ type: 'normal', text: remaining.slice(0, nextSpecial) })
      remaining = remaining.slice(nextSpecial)
      continue
    }

    // Process the matched pattern
    if (nextCodeBlock === 0 && codeBlockMatch) {
      // Fenced code block found
      segments.push({
        type: 'codeblock',
        text: codeBlockMatch[2].replace(/\n$/, ''),  // Remove trailing newline
        lang: codeBlockMatch[1] || undefined,        // Extract language if specified
      })
      remaining = remaining.slice(codeBlockMatch[0].length)
      continue
    }

    if (nextPlainCode === 0 && plainCodeMatch) {
      // Plain text code block (language header + indented code)
      // Remove indentation from code lines
      const code = plainCodeMatch[2].split('\n').map(line => line.replace(/^  /, '')).join('\n').trim()
      segments.push({
        type: 'codeblock',
        text: code,
        lang: plainCodeMatch[1],  // Language from header
      })
      remaining = remaining.slice(plainCodeMatch[0].length)
      continue
    }

    if (nextInlineCode === 0 && inlineCodeMatch) {
      // Inline code found
      segments.push({ type: 'code', text: inlineCodeMatch[1] })
      remaining = remaining.slice(inlineCodeMatch[0].length)
      continue
    }

    if (nextBold === 0 && boldMatch) {
      // Bold text found
      segments.push({ type: 'bold', text: boldMatch[1] })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    if (nextItalic === 0 && italicMatch) {
      // Italic text found
      segments.push({ type: 'italic', text: italicMatch[1] })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    break
  }

  return segments
}

// =============================================================================
// CODE BLOCK COMPONENT
// =============================================================================

/**
 * Renders a code block with syntax highlighting and line numbers.
 * 
 * Features:
 * - Bordered box with language-specific coloring
 * - Line numbers (right-aligned and padded)
 * - Language label at top
 * - Syntax highlighting for supported languages
 * - Width-constrained to fit terminal
 * 
 * @param code - The code content
 * @param lang - Programming language (optional)
 * @param maxWidth - Maximum width for the code block
 */
const CodeBlock = memo(function CodeBlock({ code, lang, maxWidth }: { code: string; lang?: string; maxWidth: number }) {
  // Split code into lines for rendering
  const lines = useMemo(() => code.split('\n'), [code])
  const maxLineNum = lines.length
  // Calculate padding width for line numbers (e.g., "  1 | " for line 1)
  const padWidth = String(maxLineNum).length
  // Calculate available width for code content (accounting for line numbers and borders)
  const availableWidth = maxWidth - padWidth - 4

  // Determine border color based on programming language
  // Each language gets a distinct color for easy identification
  const borderColor = useMemo(() => {
    if (!lang) return 'gray'
    const langLower = lang.toLowerCase()
    const colorMap: Record<string, string> = {
      javascript: 'yellow',
      typescript: 'blue',
      python: 'green',
      rust: 'red',
      go: 'cyan',
      cpp: 'magenta',
      c: 'magenta',
      java: 'yellow',
      bash: 'green',
      sql: 'cyan',
      yaml: 'gray',
      json: 'gray',
      html: 'red',
      css: 'blue',
      markdown: 'gray',
    }
    return colorMap[langLower] || 'gray'
  }, [lang])

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} marginY={1} paddingX={1}>
      {/* Language label (if specified) */}
      {lang && (
        <Box marginBottom={1}>
          <Text bold color={borderColor}>
            {lang}
          </Text>
        </Box>
      )}
      {/* Render each line with line number */}
      {lines.map((line, i) => (
        <Box key={i}>
          {/* Line number (dimmed, right-aligned) */}
          <Text dimColor>{String(i + 1).padStart(padWidth, ' ')} | </Text>
          {/* Code content with syntax highlighting */}
          <SyntaxHighlighter code={line.slice(0, availableWidth)} language={lang} />
        </Box>
      ))}
    </Box>
  )
})

// =============================================================================
// RENDER SEGMENT HELPER
// =============================================================================

/**
 * Render a single text segment with appropriate styling.
 * 
 * This is a legacy helper function (kept for compatibility).
 * The main component now uses inline rendering in the JSX.
 * 
 * @param segment - TextSegment to render
 * @param key - React key for this element
 * @returns React.ReactNode - Rendered Ink component
 */
function renderSegment(segment: TextSegment, key: number): React.ReactNode {
  switch (segment.type) {
    case 'codeblock':
      return <CodeBlock key={key} code={segment.text} lang={segment.lang} maxWidth={80} />
    case 'code':
      return (
        <Text key={key} backgroundColor="black" color="cyan">
          {segment.text}
        </Text>
      )
    case 'bold':
      return (
        <Text key={key} bold>
          {segment.text}
        </Text>
      )
    case 'italic':
      return (
        <Text key={key} italic>
          {segment.text}
        </Text>
      )
    default:
      return <Text key={key}>{segment.text}</Text>
  }
}

// =============================================================================
// MESSAGE ITEM COMPONENT
// =============================================================================

/**
 * Props for MessageItem component.
 */
interface MessageItemProps {
  /** The chat message to display */
  message: ChatMessage
  /** If true, show as streaming (no markdown parsing) */
  isStreaming?: boolean
  /** Maximum width for content */
  maxWidth: number
}

/**
 * Renders a single chat message with full markdown support.
 * 
 * This component handles:
 * - Role-based styling (user vs assistant)
 * - Markdown parsing and rendering
 * - Text wrapping for terminal width
 * - Code blocks with syntax highlighting
 * - Inline formatting (bold, italic, code)
 * 
 * Performance optimizations:
 * - useMemo for expensive parsing operations
 * - React.memo to prevent unnecessary re-renders
 * - Grouped segment rendering to minimize components
 * 
 * @param message - The ChatMessage to render
 * @param isStreaming - Whether this is a streaming message (simpler rendering)
 * @param maxWidth - Maximum width for wrapping
 */
export const MessageItem = memo(function MessageItem({ message, isStreaming, maxWidth }: MessageItemProps) {
  // Determine colors and labels based on role
  const roleColor = message.role === 'user' ? 'cyan' : 'green'
  const roleLabel = message.role === 'user' ? 'You' : 'Assistant'

  // -------------------------------------------------------------------------
  // STREAMING MODE (Simple text, no markdown)
  // -------------------------------------------------------------------------
  // During streaming, we don't parse markdown to avoid re-parsing on every update
  // This prevents flickering and improves performance
  if (isStreaming) {
    const wrappedLines = wrapText(message.content, maxWidth - 2)
    return (
      <Box flexDirection="column" marginBottom={1}>
        {/* Header: Role label + streaming indicator */}
        <Box>
          <Text bold color={roleColor}>
            {roleLabel}:
          </Text>
          <Text color="gray">{' (streaming...)'}</Text>
        </Box>
        {/* Content: Wrapped text lines */}
        <Box paddingLeft={2} flexDirection="column">
          {wrappedLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      </Box>
    )
  }

  // -------------------------------------------------------------------------
  // NORMAL MODE (Full markdown parsing)
  // -------------------------------------------------------------------------
  
  // Parse message content into markdown segments
  // Memoized to avoid re-parsing on every render
  const segments = useMemo(() => parseMarkdown(message.content), [message.content])

  // Group segments for efficient rendering
  // Code blocks are rendered separately, inline segments are grouped
  const groupedSegments = useMemo(() => {
    const groups: Array<{ segments: TextSegment[]; key: string }> = []
    let currentGroup: TextSegment[] = []
    let groupIndex = 0

    segments.forEach((seg, segIndex) => {
      if (seg.type === 'codeblock') {
        // Finish current inline group before code block
        if (currentGroup.length > 0) {
          groups.push({ 
            segments: currentGroup, 
            key: `text-${groupIndex}-${segIndex}`
          })
          groupIndex++
          currentGroup = []
        }
        // Code blocks are standalone groups
        groups.push({ 
          segments: [seg], 
          key: `code-${groupIndex}-${seg.lang || 'none'}`
        })
        groupIndex++
      } else {
        // Add inline segment to current group
        currentGroup.push(seg)
      }
    })

    // Don't forget the last group
    if (currentGroup.length > 0) {
      groups.push({ 
        segments: currentGroup, 
        key: `text-${groupIndex}-end`
      })
    }

    return groups
  }, [segments])

  // Calculate content width (accounting for padding)
  const contentMaxWidth = maxWidth - 2

  // Render the complete message
  return (
    <Box flexDirection="column" marginBottom={1} width={maxWidth}>
      {/* Message header: role label */}
      <Box>
        <Text bold color={roleColor}>
          {roleLabel}:
        </Text>
      </Box>
      {/* Message content with left padding */}
      <Box paddingLeft={2} flexDirection="column" width={contentMaxWidth}>
        {groupedSegments.map((group) =>
          // Check if this group is a single code block
          group.segments.length === 1 && group.segments[0].type === 'codeblock' ? (
            <CodeBlock 
              key={group.key} 
              code={group.segments[0].text} 
              lang={group.segments[0].lang} 
              maxWidth={contentMaxWidth} 
            />
          ) : (
            // Render inline segment group
            <Box key={group.key} flexDirection="column">
              {group.segments.map((seg, i) => {
                // Wrap normal text, pass through other types unchanged
                const lines = seg.type === 'normal' ? wrapText(seg.text, contentMaxWidth) : [seg.text]
                return lines.map((line, lineIdx) => {
                  const key = `${group.key}-seg-${i}-line-${lineIdx}`
                  // Render based on segment type
                  switch (seg.type) {
                    case 'code':
                      return (
                        <Text key={key} backgroundColor="black" color="cyan">
                          {line}
                        </Text>
                      )
                    case 'bold':
                      return (
                        <Text key={key} bold>
                          {line}
                        </Text>
                      )
                    case 'italic':
                      return (
                        <Text key={key} italic>
                          {line}
                        </Text>
                      )
                    default:
                      return <Text key={key}>{line}</Text>
                  }
                })
              })}
            </Box>
          )
        )}
      </Box>
    </Box>
  )
})
