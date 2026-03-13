import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerListEmails } from "./list-emails.js"

vi.mock("imapflow")

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  limit: z.number().int().min(1).max(100).default(20),
})

describe("list-emails input validation", () => {
  it("accepts valid input with defaults", () => {
    const result = inputSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
      expect(result.data.limit).toBe(20)
    }
  })

  it("accepts custom mailbox and limit", () => {
    const result = inputSchema.safeParse({ mailbox: "Sent", limit: 50 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("Sent")
      expect(result.data.limit).toBe(50)
    }
  })

  it("rejects limit below minimum", () => {
    const result = inputSchema.safeParse({ limit: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects limit above maximum", () => {
    const result = inputSchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer limit", () => {
    const result = inputSchema.safeParse({ limit: 10.5 })
    expect(result.success).toBe(false)
  })

  it("accepts limit at boundary values", () => {
    expect(inputSchema.safeParse({ limit: 1 }).success).toBe(true)
    expect(inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })
})

describe("registerListEmails", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer
  let mockLock: { release: ReturnType<typeof vi.fn> }

  const makeMessage = (
    uid: number,
    subject: string,
    fromName: string,
    fromAddress: string,
    date: Date,
    flags: Set<string>,
  ) => ({
    uid,
    envelope: {
      subject,
      from: [{ name: fromName, address: fromAddress }],
    },
    internalDate: date,
    flags,
  })

  beforeEach(() => {
    mockLock = { release: vi.fn() }

    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getMailboxLock: vi
        .fn<() => Promise<typeof mockLock>>()
        .mockResolvedValue(mockLock),
      mailbox: { exists: 5 },
      fetchAll: vi
        .fn()
        .mockResolvedValue([
          makeMessage(
            101,
            "Hello World",
            "Alice",
            "alice@example.com",
            new Date("2024-01-15T10:00:00Z"),
            new Set(["\\Seen"]),
          ),
          makeMessage(
            102,
            "Meeting Tomorrow",
            "Bob",
            "bob@example.com",
            new Date("2024-01-16T14:30:00Z"),
            new Set(["\\Seen", "\\Flagged"]),
          ),
        ]),
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

  it("registers a tool named 'list-emails'", () => {
    registerListEmails(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "list-emails",
      expect.objectContaining({
        description: expect.any(String),
      }),
      expect.any(Function),
    )
  })

  it("returns formatted email list on success", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toContain("101")
    expect(result.content[0].text).toContain("Hello World")
    expect(result.content[0].text).toContain("alice@example.com")
    expect(result.content[0].text).toContain("102")
    expect(result.content[0].text).toContain("Meeting Tomorrow")
    expect(result.content[0].text).toContain("bob@example.com")
  })

  it("includes flags in output", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].text).toContain("\\Flagged")
  })

  it("returns empty result when mailbox has no messages", async () => {
    mockClient.mailbox = { exists: 0 } as ImapFlow["mailbox"]

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(mockClient.fetchAll).not.toHaveBeenCalled()
    expect(result.content[0].text).toContain("No messages")
  })

  it("calculates correct sequence range for limit smaller than total", async () => {
    mockClient.mailbox = { exists: 50 } as ImapFlow["mailbox"]

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 10 })

    expect(mockClient.fetchAll).toHaveBeenCalledWith(
      "41:*",
      expect.objectContaining({
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
      }),
    )
  })

  it("uses sequence '1:*' when limit exceeds total messages", async () => {
    mockClient.mailbox = { exists: 3 } as ImapFlow["mailbox"]

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 20 })

    expect(mockClient.fetchAll).toHaveBeenCalledWith(
      "1:*",
      expect.objectContaining({ uid: true }),
    )
  })

  it("opens the specified mailbox", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "Sent", limit: 20 })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("Sent")
  })

  it("releases mailbox lock after fetching", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 20 })

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("releases mailbox lock when fetchAll throws", async () => {
    mockClient.fetchAll = vi.fn().mockRejectedValue(new Error("Fetch error"))

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ mailbox: "INBOX", limit: 20 })).rejects.toThrow(
      "Fetch error",
    )

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("calls client.connect() then client.logout()", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 20 })

    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ mailbox: "INBOX", limit: 20 })).rejects.toThrow(
      "Connection refused",
    )

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("formats sender name and address when name is present", async () => {
    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].text).toContain("Alice")
    expect(result.content[0].text).toContain("alice@example.com")
  })

  it("formats sender with address only when name is absent", async () => {
    mockClient.fetchAll = vi
      .fn()
      .mockResolvedValue([
        makeMessage(
          103,
          "No Name",
          "",
          "noname@example.com",
          new Date("2024-01-17T08:00:00Z"),
          new Set(),
        ),
      ])

    registerListEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].text).toContain("noname@example.com")
  })
})
