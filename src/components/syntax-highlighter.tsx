import React, { memo } from 'react'
import { Text } from 'ink'

// Language-specific color themes
const LANGUAGE_THEMES: Record<string, TokenColors> = {
  javascript: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    operator: 'red',
    default: 'white',
  },
  typescript: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    type: 'blue',
    operator: 'red',
    default: 'white',
  },
  python: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    decorator: 'yellow',
    operator: 'red',
    default: 'white',
  },
  rust: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    macro: 'yellow',
    lifetime: 'red',
    operator: 'red',
    default: 'white',
  },
  go: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    builtin: 'blue',
    operator: 'red',
    default: 'white',
  },
  cpp: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    preprocessor: 'yellow',
    operator: 'red',
    default: 'white',
  },
  c: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    preprocessor: 'yellow',
    operator: 'red',
    default: 'white',
  },
  java: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    number: 'yellow',
    function: 'cyan',
    annotation: 'yellow',
    operator: 'red',
    default: 'white',
  },
  bash: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    builtin: 'cyan',
    variable: 'yellow',
    operator: 'red',
    default: 'white',
  },
  sql: {
    keyword: 'magenta',
    string: 'green',
    comment: 'gray',
    function: 'cyan',
    number: 'yellow',
    operator: 'red',
    default: 'white',
  },
  yaml: {
    key: 'cyan',
    string: 'green',
    number: 'yellow',
    boolean: 'magenta',
    comment: 'gray',
    default: 'white',
  },
  json: {
    key: 'cyan',
    string: 'green',
    number: 'yellow',
    boolean: 'magenta',
    null: 'red',
    default: 'white',
  },
  html: {
    tag: 'red',
    attribute: 'yellow',
    string: 'green',
    comment: 'gray',
    default: 'white',
  },
  css: {
    property: 'cyan',
    value: 'green',
    selector: 'yellow',
    comment: 'gray',
    default: 'white',
  },
  markdown: {
    header: 'magenta',
    bold: 'white',
    italic: 'white',
    code: 'green',
    link: 'cyan',
    default: 'white',
  },
}

// Default theme for unknown languages
const DEFAULT_THEME: TokenColors = {
  keyword: 'magenta',
  string: 'green',
  comment: 'gray',
  number: 'yellow',
  function: 'cyan',
  operator: 'red',
  default: 'white',
}

interface TokenColors {
  keyword?: string
  string?: string
  comment?: string
  number?: string
  function?: string
  operator?: string
  type?: string
  decorator?: string
  macro?: string
  lifetime?: string
  builtin?: string
  preprocessor?: string
  annotation?: string
  variable?: string
  boolean?: string
  null?: string
  key?: string
  tag?: string
  attribute?: string
  property?: string
  value?: string
  selector?: string
  header?: string
  bold?: string
  italic?: string
  code?: string
  link?: string
  default: string
}

interface Token {
  type: keyof TokenColors
  value: string
}

function detectLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim()
  
  // Map aliases
  const aliases: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'rs': 'rust',
    'golang': 'go',
    'c++': 'cpp',
    'cxx': 'cpp',
    'sh': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
    'yml': 'yaml',
    'md': 'markdown',
  }
  
  return aliases[normalized] || normalized
}

function tokenize(code: string, language: string): Token[] {
  const tokens: Token[] = []
  const lines = code.split('\n')
  
  const lang = detectLanguage(language)
  
  for (const line of lines) {
    if (tokens.length > 0) {
      tokens.push({ type: 'default', value: '\n' })
    }
    tokens.push(...tokenizeLine(line, lang))
  }
  
  return tokens
}

function tokenizeLine(line: string, language: string): Token[] {
  const tokens: Token[] = []
  let remaining = line
  
  while (remaining.length > 0) {
    const token = getNextToken(remaining, language)
    tokens.push(token)
    remaining = remaining.slice(token.value.length)
  }
  
  return tokens
}

function getNextToken(text: string, language: string): Token {
  // Check for comments first
  if (text.startsWith('//') || text.startsWith('#')) {
    return { type: 'comment', value: text }
  }
  
  // Check for strings
  const stringMatch = text.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/)
  if (stringMatch) {
    return { type: 'string', value: stringMatch[0] }
  }
  
  // Check for numbers
  const numberMatch = text.match(/^(\d+\.?\d*|0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)/)
  if (numberMatch) {
    return { type: 'number', value: numberMatch[0] }
  }
  
  // Language-specific patterns
  const token = getLanguageSpecificToken(text, language)
  if (token) {
    return token
  }
  
  // Check for keywords
  const keywordMatch = text.match(/^(function|const|let|var|if|else|for|while|return|class|import|export|async|await|try|catch|throw|new|this|typeof|instanceof|void|delete|in|of|switch|case|break|continue|default|yield|debugger|with|do|finally)(?![a-zA-Z0-9_])/) ||
                      text.match(/^(def|class|if|elif|else|for|while|return|import|from|as|try|except|raise|with|async|await|lambda|pass|break|continue|global|nonlocal|assert|del)(?![a-zA-Z0-9_])/) ||
                      text.match(/^(fn|let|mut|const|if|else|match|loop|while|for|return|struct|enum|impl|trait|use|mod|pub|unsafe|async|await|move|ref|self|Self|super|crate|type|where|dyn|static|extern|yield|abstract|alignof|become|box|do|final|macro|override|priv|typeof|unsized|virtual)(?![a-zA-Z0-9_])/) ||
                      text.match(/^(func|var|const|if|else|for|range|return|import|package|type|struct|interface|map|chan|go|defer|select|case|default|switch|break|continue|fallthrough|goto|print|println|panic|recover|append|copy|close|delete|len|cap|make|new|complex|real|imag)(?![a-zA-Z0-9_])/)
  if (keywordMatch) {
    return { type: 'keyword', value: keywordMatch[0] }
  }
  
  // Check for function calls
  const functionMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/)
  if (functionMatch) {
    return { type: 'function', value: functionMatch[0] }
  }
  
  // Check for operators
  const operatorMatch = text.match(/^(===|!==|==|!=|<=|>=|=>|\+\+|--|&&|\|\||<<|>>|[+\-*/%=<>!&|^~])/)
  if (operatorMatch) {
    return { type: 'operator', value: operatorMatch[0] }
  }
  
  // Default: consume one character
  return { type: 'default', value: text[0] || '' }
}

function getLanguageSpecificToken(text: string, language: string): Token | null {
  switch (language) {
    case 'typescript':
      // Type annotations
      const typeMatch = text.match(/^:\s*([A-Z][a-zA-Z0-9_<>\[\]]*)/)
      if (typeMatch) {
        return { type: 'type', value: typeMatch[0] }
      }
      break
      
    case 'python':
      // Decorators
      const decoratorMatch = text.match(/^@[a-zA-Z_][a-zA-Z0-9_]*/)
      if (decoratorMatch) {
        return { type: 'decorator', value: decoratorMatch[0] }
      }
      // f-strings
      const fstringMatch = text.match(/^f("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
      if (fstringMatch) {
        return { type: 'string', value: fstringMatch[0] }
      }
      break
      
    case 'rust':
      // Lifetimes
      const lifetimeMatch = text.match(/^'[a-zA-Z_][a-zA-Z0-9_]*/)
      if (lifetimeMatch) {
        return { type: 'lifetime', value: lifetimeMatch[0] }
      }
      // Macros
      const macroMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)!/)
      if (macroMatch) {
        return { type: 'macro', value: macroMatch[0] }
      }
      break
      
    case 'cpp':
    case 'c':
      // Preprocessor directives
      const preprocessorMatch = text.match(/^#[a-zA-Z]+/)
      if (preprocessorMatch) {
        return { type: 'preprocessor', value: preprocessorMatch[0] }
      }
      break
      
    case 'go':
      // Built-in functions
      const builtinMatch = text.match(/^(make|new|len|cap|append|copy|close|delete|complex|real|imag|panic|recover|print|println)(?=\s*\()/)
      if (builtinMatch) {
        return { type: 'builtin', value: builtinMatch[0] }
      }
      break
      
    case 'java':
      // Annotations
      const annotationMatch = text.match(/^@[a-zA-Z_][a-zA-Z0-9_]*/)
      if (annotationMatch) {
        return { type: 'annotation', value: annotationMatch[0] }
      }
      break
      
    case 'yaml':
      // Keys
      const keyMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)(?=:)/)
      if (keyMatch) {
        return { type: 'key', value: keyMatch[0] }
      }
      break
      
    case 'json':
      // Keys (quoted)
      const jsonKeyMatch = text.match(/^"[^"]+"(?=\s*:)/)
      if (jsonKeyMatch) {
        return { type: 'key', value: jsonKeyMatch[0] }
      }
      // Boolean/null
      const boolMatch = text.match(/^(true|false|null)/)
      if (boolMatch) {
        return { type: boolMatch[0] === 'null' ? 'null' : 'boolean', value: boolMatch[0] }
      }
      break
      
    case 'html':
      // Tags
      const tagMatch = text.match(/^<[a-zA-Z][a-zA-Z0-9]*|^[a-zA-Z][a-zA-Z0-9]*(?==)/)
      if (tagMatch) {
        return { type: 'tag', value: tagMatch[0] }
      }
      break
      
    case 'css':
      // Properties and values
      const cssPropMatch = text.match(/^([a-z-]+)(?=\s*:)/)
      if (cssPropMatch) {
        return { type: 'property', value: cssPropMatch[0] }
      }
      // Selectors
      const selectorMatch = text.match(/^\.[a-zA-Z_][a-zA-Z0-9_-]*|^#[a-zA-Z_][a-zA-Z0-9_-]*/)
      if (selectorMatch) {
        return { type: 'selector', value: selectorMatch[0] }
      }
      break
  }
  
  return null
}

interface SyntaxHighlighterProps {
  code: string
  language?: string
}

export const SyntaxHighlighter = memo(function SyntaxHighlighter({ code, language = '' }: SyntaxHighlighterProps) {
  const lang = detectLanguage(language)
  const theme = LANGUAGE_THEMES[lang] || DEFAULT_THEME
  const tokens = tokenize(code, lang)
  
  return (
    <>
      {tokens.map((token, index) => (
        <Text key={index} color={theme[token.type] || theme.default}>
          {token.value}
        </Text>
      ))}
    </>
  )
})

export function getLanguageTheme(language: string): TokenColors {
  return LANGUAGE_THEMES[detectLanguage(language)] || DEFAULT_THEME
}
