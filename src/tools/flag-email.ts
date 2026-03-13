import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
  action: z.enum(["add", "remove"]),
  flags: z.array(z.string().min(1)).min(1),
})

export function registerFlagEmail(client: ImapFlow, server: McpServer): void {
  server.registerTool(
    "flag-email",
    {
      description: "Adds or removes flags on an email message by UID",
      inputSchema,
    },
    async ({ mailbox, uid, action, flags }) => {
      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)
        try {
          if (action === "add") {
            await client.messageFlagsAdd(String(uid), flags, { uid: true })
          } else {
            await client.messageFlagsRemove(String(uid), flags, { uid: true })
          }
        } finally {
          lock.release()
        }
        return {
          content: [
            {
              type: "text",
              text: `Flags ${action === "add" ? "added to" : "removed from"} message ${uid}: ${flags.join(", ")}`,
            },
          ],
        }
      } finally {
        await client.logout()
      }
    },
  )
}
