import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  since: z.string().optional(),
  before: z.string().optional(),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export function registerSearchEmails(
  client: ImapFlow,
  server: McpServer,
): void {
  server.registerTool(
    "search-emails",
    {
      description:
        "Searches for emails in a mailbox using optional filter criteria",
      inputSchema,
    },
    async ({
      mailbox,
      from,
      to,
      subject,
      since,
      before,
      seen,
      flagged,
      limit,
    }) => {
      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)
        try {
          const criteria: Record<string, unknown> = {}

          if (from !== undefined) {
            criteria.from = from
          }
          if (to !== undefined) {
            criteria.to = to
          }
          if (subject !== undefined) {
            criteria.subject = subject
          }
          if (since !== undefined) {
            criteria.since = new Date(since)
          }
          if (before !== undefined) {
            criteria.before = new Date(before)
          }
          if (seen !== undefined) {
            criteria.seen = seen
          }
          if (flagged !== undefined) {
            criteria.flagged = flagged
          }

          const searchResult = await client.search(criteria, { uid: true })
          const uids = Array.isArray(searchResult) ? searchResult : []

          if (uids.length === 0) {
            return {
              content: [{ type: "text", text: "No messages found" }],
            }
          }

          const limitedUids = uids.slice(-limit)
          const messages = []

          for (const msgUid of limitedUids) {
            const msg = await client.fetchOne(
              String(msgUid),
              { uid: true, envelope: true, flags: true, internalDate: true },
              { uid: true },
            )
            if (msg) {
              messages.push(msg)
            }
          }

          const lines = messages.map((msg) => {
            const envelope = msg.envelope as {
              date?: Date
              from?: { address?: string; name?: string }[]
              subject?: string
            }
            const flags = [...(msg.flags as Set<string>)].join(", ")
            const sender = envelope.from?.[0]?.address ?? "unknown"
            const date = (msg.internalDate as Date).toISOString()
            const parts = [
              `UID: ${msg.uid as number}`,
              `Date: ${date}`,
              `From: ${sender}`,
              `Subject: ${envelope.subject ?? "(no subject)"}`,
            ]
            if (flags) {
              parts.push(`Flags: ${flags}`)
            }
            return parts.join(" | ")
          })

          return {
            content: [{ type: "text", text: lines.join("\n") }],
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
