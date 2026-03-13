#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const isWindows = process.platform === "win32"
const npmCommand = isWindows ? "npm.cmd" : "npm"
const npxCommand = isWindows ? "npx.cmd" : "npx"

try {
  console.log("Pruning to production dependencies...")
  execFileSync(npmCommand, ["prune", "--omit=dev"], { cwd: projectRoot, stdio: "inherit" })

  console.log("Packing MCPB bundle...")
  execFileSync(npxCommand, ["@anthropic-ai/mcpb", "pack", "."], { cwd: projectRoot, stdio: "inherit" })

  console.log("Bundle complete.")
} catch (error) {
  console.error("An error occurred during bundling:", error.message)
  process.exitCode = 1
} finally {
  console.log("Restoring all dependencies...")
  try {
    execFileSync(npmCommand, ["install"], { cwd: projectRoot, stdio: "inherit" })
  } catch (error) {
    console.error("Failed to restore dependencies:", error.message)
    process.exitCode = 1
  }
}
