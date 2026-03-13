import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerSearchEmails } from "./search-emails.js"

vi.mock("imapflow")

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

const mockMessages = [
  {
    uid: 101,
    envelope: {
      date: new Date("2024-01-15T10:00:00Z"),
      from: [{ address: "alice@example.com", name: "Alice" }],
      to: [{ address: "bob@example.com", name: "Bob" }],
      subject: "Hello World",
    },
    flags: new Set(["\\Seen"]),
    internalDate: new Date("2024-01-15T10:00:00Z"),
  },
  {
    uid: 102,
    envelope: {
      date: new Date("2024-01-16T11:00:00Z"),
      from: [{ address: "carol@example.com", name: "Carol" }],
      to: [{ address: "bob@example.com", name: "Bob" }],
      subject: "Follow up",
    },
    flags: new Set(["\\Flagged"]),
    internalDate: new Date("2024-01-16T11:00:00Z"),
  },
]

describe("search-emails input validation", () => {
  it("accepts minimal valid input with defaults applied", () => {
    const result = inputSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
      expect(result.data.limit).toBe(20)
    }
  })

  it("accepts all optional fields", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX.Archive",
      from: "alice@example.com",
      to: "bob@example.com",
      subject: "Test",
      since: "2024-01-01T00:00:00Z",
      before: "2024-12-31T23:59:59Z",
      seen: true,
      flagged: false,
      limit: 50,
    })
    expect(result.success).toBe(true)
  })

  it("applies default mailbox 'INBOX' when not provided", () => {
    const result = inputSchema.safeParse({ limit: 10 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
    }
  })

  it("applies default limit of 20 when not provided", () => {
    const result = inputSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
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

  it("rejects non-boolean seen value", () => {
    const result = inputSchema.safeParse({ seen: "yes" })
    expect(result.success).toBe(false)
  })

  it("rejects non-boolean flagged value", () => {
    const result = inputSchema.safeParse({ flagged: 1 })
    expect(result.success).toBe(false)
  })

  it("accepts seen: false explicitly", () => {
    const result = inputSchema.safeParse({ seen: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.seen).toBe(false)
    }
  })

  it("accepts flagged: true explicitly", () => {
    const result = inputSchema.safeParse({ flagged: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.flagged).toBe(true)
    }
  })

  it("accepts limit at boundary values 1 and 100", () => {
    expect(inputSchema.safeParse({ limit: 1 }).success).toBe(true)
    expect(inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })
})

describe("registerSearchEmails", () => {
  let mockLock: { release: ReturnType<typeof vi.fn> }
  let mockClient: ImapFlow
  let mockServer: McpServer

  beforeEach(() => {
    mockLock = { release: vi.fn() }

    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getMailboxLock: vi
        .fn<() => Promise<typeof mockLock>>()
        .mockResolvedValue(mockLock),
      search: vi.fn<() => Promise<number[]>>().mockResolvedValue([101, 102]),
      fetchOne: vi.fn().mockImplementation(async (uid: string) => {
        const numUid = parseInt(uid)
        return mockMessages.find((m) => m.uid === numUid) ?? mockMessages[0]
      }),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

  it("registers a tool named 'search-emails'", () => {
    registerSearchEmails(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "search-emails",
      expect.objectContaining({
        description: expect.any(String),
      }),
      expect.any(Function),
    )
  })

  it("connects, locks mailbox, and logs out on success", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 20 })

    expect(mockClient.connect).toHaveBeenCalledOnce()
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX")
    expect(mockLock.release).toHaveBeenCalledOnce()
    expect(mockClient.logout).toHaveBeenCalledOnce()
  })

  it("releases lock and logs out even when search throws", async () => {
    mockClient.search = vi.fn().mockRejectedValue(new Error("SEARCH failed"))

    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ mailbox: "INBOX", limit: 20 })).rejects.toThrow(
      "SEARCH failed",
    )

    expect(mockLock.release).toHaveBeenCalledOnce()
    expect(mockClient.logout).toHaveBeenCalledOnce()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({ mailbox: "INBOX", limit: 20 })).rejects.toThrow(
      "Connection refused",
    )

    expect(mockClient.logout).toHaveBeenCalledOnce()
  })

  it("returns 'No messages found' when search returns empty array", async () => {
    mockClient.search = vi.fn().mockResolvedValue([])

    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].text).toBe("No messages found")
  })

  it("returns formatted message list on successful search", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].type).toBe("text")
    const text = result.content[0].text
    expect(text).toContain("101")
    expect(text).toContain("alice@example.com")
    expect(text).toContain("Hello World")
    expect(text).toContain("102")
    expect(text).toContain("carol@example.com")
    expect(text).toContain("Follow up")
  })

  it("includes flags in formatted output", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    const text = result.content[0].text
    expect(text).toContain("\\Seen")
    expect(text).toContain("\\Flagged")
  })

  it("respects limit by taking last N UIDs", async () => {
    mockClient.search = vi.fn().mockResolvedValue([99, 100, 101, 102])
    mockClient.fetchOne = vi.fn().mockImplementation(async (uid: string) => {
      const numUid = parseInt(uid)
      return {
        uid: numUid,
        envelope: {
          date: new Date("2024-01-15T10:00:00Z"),
          from: [
            {
              address: `sender${numUid}@example.com`,
              name: `Sender ${numUid}`,
            },
          ],
          to: [{ address: "bob@example.com", name: "Bob" }],
          subject: `Message ${numUid}`,
        },
        flags: new Set<string>(),
        internalDate: new Date("2024-01-15T10:00:00Z"),
      }
    })

    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", limit: 2 })

    expect(mockClient.fetchOne).toHaveBeenCalledTimes(2)
    expect(mockClient.fetchOne).toHaveBeenCalledWith(
      "101",
      expect.objectContaining({
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }),
      { uid: true },
    )
    expect(mockClient.fetchOne).toHaveBeenCalledWith(
      "102",
      expect.objectContaining({
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }),
      { uid: true },
    )
  })

  it("builds search criteria only from provided optional params", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      from: "alice@example.com",
      subject: "Hello",
      seen: true,
      limit: 20,
    })

    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alice@example.com",
        subject: "Hello",
        seen: true,
      }),
      { uid: true },
    )
    const callArg = vi.mocked(mockClient.search).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(callArg).not.toHaveProperty("to")
    expect(callArg).not.toHaveProperty("before")
    expect(callArg).not.toHaveProperty("since")
    expect(callArg).not.toHaveProperty("flagged")
  })

  it("converts since and before ISO strings to Date objects in criteria", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      since: "2024-01-01T00:00:00Z",
      before: "2024-12-31T23:59:59Z",
      limit: 20,
    })

    const callArg = vi.mocked(mockClient.search).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(callArg.since).toBeInstanceOf(Date)
    expect(callArg.before).toBeInstanceOf(Date)
    expect((callArg.since as Date).toISOString()).toBe(
      "2024-01-01T00:00:00.000Z",
    )
    expect((callArg.before as Date).toISOString()).toBe(
      "2024-12-31T23:59:59.000Z",
    )
  })

  it("includes flagged: false in criteria when explicitly set", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", flagged: false, limit: 20 })

    const callArg = vi.mocked(mockClient.search).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(callArg).toHaveProperty("flagged", false)
  })

  it("uses specified mailbox for getMailboxLock", async () => {
    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX.Archive", limit: 20 })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX.Archive")
  })

  it("skips null fetchOne results without failing", async () => {
    mockClient.search = vi.fn().mockResolvedValue([101, 999])
    mockClient.fetchOne = vi.fn().mockImplementation(async (uid: string) => {
      if (uid === "999") {
        return null
      }
      return mockMessages[0]
    })

    registerSearchEmails(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({ mailbox: "INBOX", limit: 20 })

    expect(result.content[0].text).toContain("101")
    expect(result.content[0].text).not.toContain("999")
  })
})
