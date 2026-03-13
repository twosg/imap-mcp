import { ImapFlow } from "imapflow"
import { z } from "zod/v4"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
})

type AddressObject = {
  name?: string | null
  address: string
}

function formatAddress(addr: AddressObject): string {
  if (!addr.name) {
    return addr.address
  }

  return `${addr.name} <${addr.address}>`
}

function formatAddressList(addresses: AddressObject[]): string {
  return addresses.map(formatAddress).join(", ")
}

export function registerReadEmail(client: ImapFlow, server: McpServer): void {
  server.registerTool(
    "read-email",
    {
      description: "Reads a single email message by UID from an IMAP mailbox",
      inputSchema,
    },
    async ({ mailbox = "INBOX", uid }) => {
      try {
        await client.connect()

        const lock = await client.getMailboxLock(mailbox)

        try {
          const message = await client.fetchOne(
            String(uid),
            { uid: true, envelope: true, flags: true, source: true },
            { uid: true },
          )

          if (!message) {
            throw new Error("Message not found")
          }

          const envelope = message.envelope
          const flags = message.flags ?? new Set<string>()
          const source = message.source

          if (!envelope) {
            throw new Error("Message envelope not available")
          }

          const lines: string[] = [
            `From: ${formatAddressList((envelope.from ?? []) as AddressObject[])}`,
            `To: ${formatAddressList((envelope.to ?? []) as AddressObject[])}`,
          ]

          if (envelope.cc?.length) {
            lines.push(
              `CC: ${formatAddressList(envelope.cc as AddressObject[])}`,
            )
          }

          lines.push(
            `Subject: ${envelope.subject ?? ""}`,
            `Date: ${envelope.date?.toISOString() ?? ""}`,
            `Flags: ${[...flags].join(", ")}`,
            "",
            (source as Buffer).toString(),
          )

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
