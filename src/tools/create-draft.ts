import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  to: z.email().max(254),
  subject: z
    .string()
    .max(998)
    .trim()
    .refine((s) => !/[\r\n]/.test(s), "Subject must not contain line breaks"),
  body: z.string().max(1_000_000),
  from: z.email().max(254).optional(),
})

export function registerCreateDraft(client: ImapFlow, server: McpServer): void {
  server.registerTool(
    "create-draft",
    {
      description: "Creates a draft email message",
      inputSchema,
    },
    async ({ to, subject, body, from }) => {
      const draftsFolder = process.env.IMAP_DRAFTS_FOLDER || "INBOX.Drafts"
      const sender = from || process.env.IMAP_USERNAME || ""
      const message = [
        `From: ${sender}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        "",
        body,
      ].join("\r\n")

      try {
        await client.connect()
        try {
          await client.append(draftsFolder, message, ["\\Draft"])
        } catch {
          await client.append("Drafts", message, ["\\Draft"])
        }
        return {
          content: [
            {
              type: "text",
              text: `Draft created successfully for ${to}`,
            },
          ],
        }
      } finally {
        await client.logout()
      }
    },
  )
}
