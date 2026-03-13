import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerReadEmail } from "./read-email.js"

vi.mock("imapflow")

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
})

describe("read-email input validation", () => {
  it("accepts valid input with explicit mailbox", () => {
    const result = inputSchema.safeParse({ mailbox: "INBOX.Sent", uid: 42 })
    expect(result.success).toBe(true)
  })

  it("defaults mailbox to INBOX when omitted", () => {
    const result = inputSchema.safeParse({ uid: 1 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
    }
  })

  it("rejects missing uid", () => {
    const result = inputSchema.safeParse({ mailbox: "INBOX" })
    expect(result.success).toBe(false)
  })

  it("rejects uid of zero", () => {
    const result = inputSchema.safeParse({ uid: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects negative uid", () => {
    const result = inputSchema.safeParse({ uid: -5 })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer uid", () => {
    const result = inputSchema.safeParse({ uid: 1.5 })
    expect(result.success).toBe(false)
  })

  it("rejects non-numeric uid", () => {
    const result = inputSchema.safeParse({ uid: "abc" })
    expect(result.success).toBe(false)
  })
})

describe("registerReadEmail", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer
  let mockLock: { release: ReturnType<typeof vi.fn> }

  const mockMessage = {
    uid: 42,
    envelope: {
      from: [{ name: "Alice Sender", address: "alice@example.com" }],
      to: [{ name: "Bob Receiver", address: "bob@example.com" }],
      cc: [{ name: "Carol CC", address: "carol@example.com" }],
      subject: "Hello from Alice",
      date: new Date("2026-03-13T10:00:00Z"),
    },
    flags: new Set(["\\Seen"]),
    source: Buffer.from(
      "From: alice@example.com\r\nTo: bob@example.com\r\n\r\nBody content here.",
    ),
  }

  beforeEach(() => {
    mockLock = { release: vi.fn() }

    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getMailboxLock: vi
        .fn<(mailbox: string) => Promise<{ release: () => void }>>()
        .mockResolvedValue(mockLock),
      fetchOne: vi.fn().mockResolvedValue(mockMessage),
    } as unknown as ImapFlow

    mockServer = {
      registerTool: vi.fn(),
    } as unknown as McpServer
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function getToolHandler(): (args: Record<string, unknown>) => Promise<{
    content: { type: string; text: string }[]
  }> {
    return vi.mocked(mockServer.registerTool).mock.calls[0][2] as ReturnType<
      typeof getToolHandler
    >
  }

  it("registers a tool named 'read-email'", () => {
    registerReadEmail(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "read-email",
      expect.objectContaining({
        description: expect.any(String),
      }),
      expect.any(Function),
    )
  })

  it("returns formatted email with all headers and body", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", uid: 42 })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")

    const text = result.content[0].text
    expect(text).toContain("From: Alice Sender <alice@example.com>")
    expect(text).toContain("To: Bob Receiver <bob@example.com>")
    expect(text).toContain("CC: Carol CC <carol@example.com>")
    expect(text).toContain("Subject: Hello from Alice")
    expect(text).toContain("Flags: \\Seen")
    expect(text).toContain(
      "From: alice@example.com\r\nTo: bob@example.com\r\n\r\nBody content here.",
    )
  })

  it("omits CC line when cc is null", async () => {
    const messageWithoutCc = {
      ...mockMessage,
      envelope: { ...mockMessage.envelope, cc: null },
    }
    mockClient.fetchOne = vi.fn().mockResolvedValue(messageWithoutCc)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ uid: 42 })

    expect(result.content[0].text).not.toContain("CC:")
  })

  it("formats address without name using address only", async () => {
    const messageWithAddressOnly = {
      ...mockMessage,
      envelope: {
        ...mockMessage.envelope,
        from: [{ name: null, address: "noreply@example.com" }],
        to: [{ name: "", address: "user@example.com" }],
        cc: null,
      },
    }
    mockClient.fetchOne = vi.fn().mockResolvedValue(messageWithAddressOnly)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ uid: 42 })

    const text = result.content[0].text
    expect(text).toContain("From: noreply@example.com")
    expect(text).toContain("To: user@example.com")
  })

  it("calls fetchOne with UID as string and uid:true option", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX.Archive", uid: 99 })

    expect(mockClient.fetchOne).toHaveBeenCalledWith(
      "99",
      { uid: true, envelope: true, flags: true, source: true },
      { uid: true },
    )
  })

  it("uses the provided mailbox for getMailboxLock", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX.Sent", uid: 1 })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX.Sent")
  })

  it("defaults mailbox to INBOX when not provided", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ uid: 1 })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX")
  })

  it("releases the mailbox lock after successful fetch", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ uid: 42 })

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("releases the mailbox lock when fetchOne throws", async () => {
    mockClient.fetchOne = vi.fn().mockRejectedValue(new Error("Fetch error"))

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ uid: 42 })).rejects.toThrow("Fetch error")

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("calls logout after successful fetch", async () => {
    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ uid: 42 })

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls logout when connect throws", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ uid: 42 })).rejects.toThrow("Connection refused")

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("throws when message is not found", async () => {
    mockClient.fetchOne = vi.fn().mockResolvedValue(null)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ uid: 999 })).rejects.toThrow("Message not found")
  })

  it("releases lock and calls logout when message is not found", async () => {
    mockClient.fetchOne = vi.fn().mockResolvedValue(null)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ uid: 999 })).rejects.toThrow()

    expect(mockLock.release).toHaveBeenCalled()
    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("handles empty flags set", async () => {
    const messageNoFlags = {
      ...mockMessage,
      flags: new Set<string>(),
    }
    mockClient.fetchOne = vi.fn().mockResolvedValue(messageNoFlags)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ uid: 42 })

    expect(result.content[0].text).toContain("Flags: ")
  })

  it("handles multiple recipients in to and cc fields", async () => {
    const messageMultipleRecipients = {
      ...mockMessage,
      envelope: {
        ...mockMessage.envelope,
        to: [
          { name: "Bob", address: "bob@example.com" },
          { name: "Dave", address: "dave@example.com" },
        ],
        cc: [
          { name: "Eve", address: "eve@example.com" },
          { name: null, address: "frank@example.com" },
        ],
      },
    }
    mockClient.fetchOne = vi.fn().mockResolvedValue(messageMultipleRecipients)

    registerReadEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ uid: 42 })

    const text = result.content[0].text
    expect(text).toContain("Bob <bob@example.com>")
    expect(text).toContain("Dave <dave@example.com>")
    expect(text).toContain("Eve <eve@example.com>")
    expect(text).toContain("frank@example.com")
  })
})
