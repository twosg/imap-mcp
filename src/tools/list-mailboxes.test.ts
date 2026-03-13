import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerListMailboxes } from "./list-mailboxes.js"

vi.mock("imapflow")

const inputSchema = z.object({})

const mockMailboxes = [
  {
    path: "INBOX",
    specialUse: "\\Inbox",
    subscribed: true,
    delimiter: ".",
    flags: new Set(["\\HasNoChildren"]),
  },
  {
    path: "INBOX.Sent",
    specialUse: "\\Sent",
    subscribed: true,
    delimiter: ".",
    flags: new Set(["\\HasNoChildren", "\\Sent"]),
  },
  {
    path: "INBOX.Drafts",
    specialUse: "\\Drafts",
    subscribed: false,
    delimiter: ".",
    flags: new Set(["\\HasNoChildren", "\\Drafts"]),
  },
  {
    path: "INBOX.Archive",
    specialUse: "",
    subscribed: true,
    delimiter: ".",
    flags: new Set<string>(),
  },
]

describe("list-mailboxes input validation", () => {
  it("accepts empty input", () => {
    const result = inputSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe("registerListMailboxes", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer

  beforeEach(() => {
    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      list: vi
        .fn<() => Promise<typeof mockMailboxes>>()
        .mockResolvedValue(mockMailboxes),
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

  it("registers a tool named 'list-mailboxes'", () => {
    registerListMailboxes(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "list-mailboxes",
      expect.objectContaining({
        description: "Lists all available IMAP mailboxes",
      }),
      expect.any(Function),
    )
  })

  it("returns formatted mailbox list on success", async () => {
    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({})

    expect(result.content[0].type).toBe("text")
    const text = result.content[0].text
    expect(text).toContain("Path: INBOX")
    expect(text).toContain("Special use: \\Inbox")
    expect(text).toContain("Subscribed: true")
    expect(text).toContain("Delimiter: .")
    expect(text).toContain("Path: INBOX.Sent")
    expect(text).toContain("Path: INBOX.Drafts")
    expect(text).toContain("Subscribed: false")
  })

  it("includes flags converted from Set to string", async () => {
    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({})

    const text = result.content[0].text
    expect(text).toContain("\\HasNoChildren")
    expect(text).toContain("\\Sent")
    expect(text).toContain("\\Drafts")
  })

  it("omits specialUse line when falsy", async () => {
    mockClient.list = vi.fn().mockResolvedValue([
      {
        path: "INBOX.Archive",
        specialUse: "",
        subscribed: true,
        delimiter: ".",
        flags: new Set<string>(),
      },
    ])

    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({})

    expect(result.content[0].text).not.toContain("Special use:")
  })

  it("omits flags line when flags Set is empty", async () => {
    mockClient.list = vi.fn().mockResolvedValue([
      {
        path: "INBOX.Archive",
        specialUse: "",
        subscribed: true,
        delimiter: ".",
        flags: new Set<string>(),
      },
    ])

    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({})

    expect(result.content[0].text).not.toContain("Flags:")
  })

  it("returns fallback message when no mailboxes exist", async () => {
    mockClient.list = vi.fn().mockResolvedValue([])

    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({})

    expect(result.content[0].text).toBe("No mailboxes found")
  })

  it("calls client.logout() after successful list", async () => {
    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({})

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({})).rejects.toThrow("Connection refused")

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls client.logout() on list error", async () => {
    mockClient.list = vi
      .fn()
      .mockRejectedValue(new Error("LIST command failed"))

    registerListMailboxes(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(handler({})).rejects.toThrow("LIST command failed")

    expect(mockClient.logout).toHaveBeenCalled()
  })
})
