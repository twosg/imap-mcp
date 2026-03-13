#!/usr/bin/env node

process.on("uncaughtException", (error) => {
  console.error(`[imap-mcp] uncaughtException: ${error.stack ?? error.message}`)
  process.exitCode = 1
})
process.on("unhandledRejection", (reason) => {
  console.error(`[imap-mcp] unhandledRejection: ${reason}`)
  process.exitCode = 1
})

import "dotenv/config"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerCreateDraft } from "./tools/create-draft.js"
import { registerFlagEmail } from "./tools/flag-email.js"
import { registerListEmails } from "./tools/list-emails.js"
import { registerListMailboxes } from "./tools/list-mailboxes.js"
import { registerMoveEmail } from "./tools/move-email.js"
import { registerReadEmail } from "./tools/read-email.js"
import { registerSearchEmails } from "./tools/search-emails.js"

const server = new McpServer({
  name: "imap-mcp",
  version: "1.1.0",
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
  registerFlagEmail(client, server)
  registerListEmails(client, server)
  registerListMailboxes(client, server)
  registerMoveEmail(client, server)
  registerReadEmail(client, server)
  registerSearchEmails(client, server)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (!process.env.VITEST) {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
