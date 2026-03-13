import { ImapFlow, FetchMessageObject } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  limit: z.number().int().min(1).max(100).default(20),
})

function formatSender(from: { name: string; address: string }[]): string {
  if (!from || from.length === 0) {
    return "Unknown"
  }

  const sender = from[0]

  return sender.name ? `${sender.name} <${sender.address}>` : sender.address
}

function formatMessage(message: FetchMessageObject): string {
  const internalDate =
    message.internalDate instanceof Date
      ? message.internalDate
      : new Date(message.internalDate as string)
  const date = !isNaN(internalDate.getTime())
    ? internalDate.toISOString().replace("T", " ").substring(0, 19)
    : "Unknown date"
  const sender = formatSender(
    (message.envelope?.from ?? []) as { name: string; address: string }[],
  )
  const subject = message.envelope?.subject ?? "(no subject)"
  const flags = message.flags ? [...message.flags].join(", ") : ""

  const parts = [
    `UID: ${message.uid}`,
    `Date: ${date}`,
    `From: ${sender}`,
    `Subject: ${subject}`,
  ]

  if (flags) {
    parts.push(`Flags: ${flags}`)
  }

  return parts.join(" | ")
}

export function registerListEmails(client: ImapFlow, server: McpServer): void {
  server.registerTool(
    "list-emails",
    {
      description: "Lists the most recent emails from an IMAP mailbox",
      inputSchema,
    },
    async ({ mailbox, limit }) => {
      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)
        try {
          const total = (client.mailbox as { exists: number }).exists

          if (total === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No messages found in ${mailbox}`,
                },
              ],
            }
          }

          const startSeq = Math.max(1, total - limit + 1)
          const messages = await client.fetchAll(`${startSeq}:*`, {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
          })

          const lines = messages.map(formatMessage)

          return {
            content: [
              {
                type: "text",
                text: lines.join("\n"),
              },
            ],
          }
        } finally {
          lock.release()
        }
      } finally {
        await client.logout()
      }
    },
  )
}
