#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

const root = process.cwd()
const apiDir = path.join(root, 'src', 'app', 'api')

export const API_HANDLER_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

export const PUBLIC_ROUTE_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/cos/image/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/storage/sign/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

const AUTH_CALL_PATTERNS = [
  /\brequireUserAuth\s*\(/,
  /\brequireAdminAuth\s*\(/,
  /\brequireProjectAuth\s*\(/,
  /\brequireProjectAuthLight\s*\(/,
  // 共享的鉴权 helper (editor 路由走 requireOwnedProject/Editor,内部已调 projectAuth)
  /\brequireOwnedProject\s*\(/,
  /\brequireOwnedEditorProject\s*\(/,
  // 用 create*Route 工厂封装的路由(内部包了 apiHandler + auth),guard 不需要再正则命中
  /\bcreateEditorAiRoute\s*\(/,
]

// 共享路由工厂 —— 工厂函数内部已经包了 apiHandler,调用侧不需要再直接出现 apiHandler(
const ROUTE_FACTORY_PATTERNS = [
  /\bcreateEditorAiRoute\s*\(/,
]

function fail(title, details = []) {
  process.stderr.write(`\n[api-route-contract-guard] ${title}\n`)
  for (const detail of details) {
    process.stderr.write(`  - ${detail}\n`)
  }
  process.exit(1)
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (entry.name === 'route.ts') out.push(fullPath)
  }
  return out
}

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function hasApiHandlerWrapper(content) {
  if (/\bapiHandler\s*\(/.test(content)) return true
  // 路由通过共享工厂创建,工厂内部包了 apiHandler + auth,不再需要每个路由直接出现 apiHandler(
  return ROUTE_FACTORY_PATTERNS.some((pattern) => pattern.test(content))
}

function hasRequiredAuth(content) {
  return AUTH_CALL_PATTERNS.some((pattern) => pattern.test(content))
}

export function inspectRouteContract(relPath, content) {
  const violations = []

  if (!API_HANDLER_ALLOWLIST.has(relPath) && !hasApiHandlerWrapper(content)) {
    violations.push(`${relPath} missing apiHandler wrapper`)
  }

  if (!PUBLIC_ROUTE_ALLOWLIST.has(relPath) && !hasRequiredAuth(content)) {
    violations.push(`${relPath} missing requireUserAuth/requireProjectAuth/requireProjectAuthLight`)
  }

  return violations
}

export function findApiRouteContractViolations(scanRoot = root) {
  const routesRoot = path.join(scanRoot, 'src', 'app', 'api')
  return walk(routesRoot)
    .map((fullPath) => {
      const relPath = path.relative(scanRoot, fullPath).split(path.sep).join('/')
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectRouteContract(relPath, content)
    })
    .flat()
}

export function main() {
  if (!fs.existsSync(apiDir)) {
    fail('Missing src/app/api directory')
  }

  const violations = walk(apiDir)
    .map((fullPath) => {
      const relPath = toRel(fullPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectRouteContract(relPath, content)
    })
    .flat()

  if (violations.length > 0) {
    fail('Found API route contract violations', violations)
  }

  process.stdout.write(
    `[api-route-contract-guard] OK routes=${walk(apiDir).length} public=${PUBLIC_ROUTE_ALLOWLIST.size} apiHandlerExceptions=${API_HANDLER_ALLOWLIST.size}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
