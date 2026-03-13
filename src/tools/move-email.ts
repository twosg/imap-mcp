import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
  destination: z.string().min(1),
})

export function registerMoveEmail(client: ImapFlow, server: McpServer): void {
  server.registerTool(
    "move-email",
    {
      description: "Moves an email message to a different mailbox folder",
      inputSchema,
    },
    async ({ mailbox, uid, destination }) => {
      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)
        try {
          await client.messageMove(String(uid), destination, { uid: true })
        } finally {
          lock.release()
        }
        return {
          content: [
            {
              type: "text",
              text: `Message ${uid} moved to ${destination}`,
            },
          ],
        }
      } finally {
        await client.logout()
      }
    },
  )
}
