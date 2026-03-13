import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({})

export function registerListMailboxes(
  client: ImapFlow,
  server: McpServer,
): void {
  server.registerTool(
    "list-mailboxes",
    {
      description: "Lists all available IMAP mailboxes",
      inputSchema,
    },
    async () => {
      try {
        await client.connect()
        const mailboxes = await client.list()
        const lines = mailboxes.map((mailbox) => {
          const flags = [...mailbox.flags].join(", ")
          const parts = [`Path: ${mailbox.path}`]

          if (mailbox.specialUse) {
            parts.push(`Special use: ${mailbox.specialUse}`)
          }

          if (flags) {
            parts.push(`Flags: ${flags}`)
          }

          parts.push(`Subscribed: ${mailbox.subscribed}`)
          parts.push(`Delimiter: ${mailbox.delimiter}`)

          return parts.join(" | ")
        })

        return {
          content: [
            {
              type: "text",
              text: lines.length > 0 ? lines.join("\n") : "No mailboxes found",
            },
          ],
        }
      } finally {
        await client.logout()
      }
    },
  )
}
