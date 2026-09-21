#!/usr/bin/env node
// Guardrail for the Chinese-translation feature: fails the build if a new
// English key ships without a Chinese counterpart, or if a page/component
// that's supposed to be on the i18n system has hardcoded, untranslated text.
//
// This exists because the manager-facing half of the app was originally built
// with zero t() calls at all — the language toggle just silently did nothing
// there. Run manually with `npm run check:i18n`; it also runs as part of
// `npm run build` and in CI.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

// ---------------------------------------------------------------------------
// 1. en/zh key parity — every English key needs a Chinese translation.
// ---------------------------------------------------------------------------

function extractDict(varName, src) {
  const start = new RegExp(`const ${varName}\\b[^=]*=\\s*\\{`).exec(src)
  if (!start) throw new Error(`check-i18n: could not find "const ${varName} = {" in i18n.tsx`)
  let i = start.index + start[0].length
  let depth = 1
  const bodyStart = i
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  const body = src.slice(bodyStart, i - 1)
  const keys = new Set()
  const keyRe = /(^|\n)\s*'([a-zA-Z0-9_.]+)':/g
  let m
  while ((m = keyRe.exec(body))) keys.add(m[2])
  return keys
}

const i18nPath = path.join(SRC, 'lib/i18n.tsx')
const i18nSrc = fs.readFileSync(i18nPath, 'utf8')
const enKeys = extractDict('en', i18nSrc)
const zhKeys = extractDict('zh', i18nSrc)

const errors = []

const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k)).sort()
if (missingInZh.length) {
  errors.push(
    `Missing Chinese translation for ${missingInZh.length} key(s) in Frontend/src/lib/i18n.tsx:\n` +
      missingInZh.map((k) => `  - ${k}`).join('\n'),
  )
}

const extraInZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort()
if (extraInZh.length) {
  errors.push(
    `zh has ${extraInZh.length} key(s) not present in en (typo, or a leftover from a rename?):\n` +
      extraInZh.map((k) => `  - ${k}`).join('\n'),
  )
}

// ---------------------------------------------------------------------------
// 2. hardcoded-text scan — every .tsx under pages/ and components/ must run
//    its user-facing text through t(), unless explicitly exempted below.
// ---------------------------------------------------------------------------

// Files not yet on the i18n system. This list should only ever shrink — when
// a file below gets wired up to useT(), remove it here rather than leaving it
// permanently exempt.
const EXEMPT = new Set(
  [
    'pages/Terms.tsx',
    'pages/Privacy.tsx',
    'pages/RegisterManager.tsx',
    'pages/RegisterStore.tsx',
    'pages/RequestAccess.tsx',
    'pages/Setup.tsx',
    'pages/DeleteAccountRequest.tsx',
  ].map((p) => path.join(SRC, p)),
)

// Literals that are fine to leave in English regardless of language (brand
// name, etc.) — add to this rather than exempting a whole file.
const ALLOW_LITERALS = new Set([
  'Fruit Crew',
  // LangToggle always shows the target language's own name, independent of
  // the current UI language — not a translatable string.
  '中文',
  'EN',
])

const TEXT_ATTRS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'label'])

function hasWordChar(s) {
  return /\p{L}/u.test(s)
}

function isAllowed(text) {
  const trimmed = text.trim()
  if (!trimmed) return true // whitespace-only jsx text between tags
  if (!hasWordChar(trimmed)) return true // punctuation / emoji / numbers only
  if (ALLOW_LITERALS.has(trimmed)) return true
  return false
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

function checkExprForLiterals(expr, sf, violations, lineOf) {
  if (!expr) return
  if (ts.isStringLiteralLike(expr)) {
    const text = expr.text
    if (!isAllowed(text)) violations.push({ line: lineOf(expr.getStart(sf)), text: text.trim() })
  } else if (ts.isConditionalExpression(expr)) {
    checkExprForLiterals(expr.whenTrue, sf, violations, lineOf)
    checkExprForLiterals(expr.whenFalse, sf, violations, lineOf)
  } else if (
    ts.isBinaryExpression(expr) &&
    [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
      expr.operatorToken.kind,
    )
  ) {
    checkExprForLiterals(expr.right, sf, violations, lineOf)
  }
}

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8')
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations = []
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1

  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf)
      if (!isAllowed(text)) violations.push({ line: lineOf(node.getStart(sf)), text: text.trim() })
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      if (TEXT_ATTRS.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          const text = node.initializer.text
          if (!isAllowed(text)) violations.push({ line: lineOf(node.getStart(sf)), text: `${name}="${text}"` })
        } else if (ts.isJsxExpression(node.initializer)) {
          checkExprForLiterals(node.initializer.expression, sf, violations, lineOf)
        }
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      checkExprForLiterals(node.expression, sf, violations, lineOf)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return violations
}

const targets = [...walk(path.join(SRC, 'pages')), ...walk(path.join(SRC, 'components'))].filter(
  (f) => !EXEMPT.has(f),
)

const textViolations = []
for (const file of targets) {
  const violations = scanFile(file)
  if (violations.length) textViolations.push({ file: path.relative(ROOT, file), violations })
}

if (textViolations.length) {
  const lines = textViolations
    .map(
      ({ file, violations }) =>
        `  ${file}\n` + violations.map((v) => `    line ${v.line}: "${v.text}"`).join('\n'),
    )
    .join('\n')
  errors.push(
    `Found hardcoded, untranslated text in ${textViolations.length} file(s). Wrap it with t('...') and add ` +
      `the key to both the en and zh dicts in Frontend/src/lib/i18n.tsx. If it's genuinely fine in English ` +
      `(a proper noun, etc.), add the exact string to ALLOW_LITERALS in scripts/check-i18n.mjs instead:\n` +
      lines,
  )
}

if (errors.length) {
  console.error('\ni18n check failed:\n')
  console.error(errors.join('\n\n'))
  console.error(
    `\nIf a file genuinely isn't ready for translation yet, add it to EXEMPT in scripts/check-i18n.mjs ` +
      `(and note it as a known gap) rather than silencing this check some other way.\n`,
  )
  process.exit(1)
}

console.log(`i18n check passed — ${enKeys.size} keys in sync, ${targets.length} file(s) scanned clean.`)
