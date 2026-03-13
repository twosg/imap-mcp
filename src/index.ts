#!/usr/bin/env node

import "dotenv/config"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerCreateDraft } from "./tools/create-draft.js"

const server = new McpServer({
  name: "imap-mcp",
  version: "1.0.0",
})

function validateConfig(): {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  tls: { rejectUnauthorized: boolean }
  logger: false
} {
  const requiredVars = ["IMAP_HOST", "IMAP_USERNAME", "IMAP_PASSWORD"] as const

  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`)
    }
  }

  const port = parseInt(process.env.IMAP_PORT || "993")
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid IMAP_PORT: must be a number between 1 and 65535`)
  }

  return {
    host: process.env.IMAP_HOST!,
    port,
    secure: process.env.IMAP_USE_SSL === "true",
    auth: {
      user: process.env.IMAP_USERNAME!,
      pass: process.env.IMAP_PASSWORD!,
    },
    tls: {
      rejectUnauthorized: process.env.IMAP_REJECT_UNAUTHORIZED !== "false",
    },
    logger: false,
  }
}

export async function main(): Promise<void> {
  const imapConfig = validateConfig()
  const client = new ImapFlow(imapConfig)

  registerCreateDraft(client, server)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// Only run main if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
