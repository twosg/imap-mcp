import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerFlagEmail } from "./flag-email.js"

vi.mock("imapflow")

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
  action: z.enum(["add", "remove"]),
  flags: z.array(z.string().min(1)).min(1),
})

describe("flag-email input validation", () => {
  it("accepts valid add action with standard flags", () => {
    const result = inputSchema.safeParse({
      uid: 42,
      action: "add",
      flags: ["\\Seen", "\\Flagged"],
    })
    expect(result.success).toBe(true)
  })

  it("accepts valid remove action", () => {
    const result = inputSchema.safeParse({
      uid: 10,
      action: "remove",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(true)
  })

  it("applies default mailbox INBOX", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
    }
  })

  it("accepts custom mailbox", () => {
    const result = inputSchema.safeParse({
      mailbox: "Sent",
      uid: 1,
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("Sent")
    }
  })

  it("rejects invalid action value", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "toggle",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing action", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects zero uid", () => {
    const result = inputSchema.safeParse({
      uid: 0,
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects negative uid", () => {
    const result = inputSchema.safeParse({
      uid: -5,
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer uid", () => {
    const result = inputSchema.safeParse({
      uid: 1.5,
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing uid", () => {
    const result = inputSchema.safeParse({
      action: "add",
      flags: ["\\Seen"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty flags array", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "add",
      flags: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects flags array containing empty string", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "add",
      flags: ["\\Seen", ""],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing flags", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "add",
    })
    expect(result.success).toBe(false)
  })

  it("accepts multiple flags", () => {
    const result = inputSchema.safeParse({
      uid: 1,
      action: "add",
      flags: ["\\Seen", "\\Flagged", "\\Answered"],
    })
    expect(result.success).toBe(true)
  })
})

describe("registerFlagEmail", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer
  let mockLock: { release: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockLock = { release: vi.fn() }

    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getMailboxLock: vi
        .fn<() => Promise<typeof mockLock>>()
        .mockResolvedValue(mockLock),
      messageFlagsAdd: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      messageFlagsRemove: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(true),
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

  it("registers a tool named 'flag-email'", () => {
    registerFlagEmail(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "flag-email",
      expect.objectContaining({
        description: expect.any(String),
      }),
      expect.any(Function),
    )
  })

  it("calls messageFlagsAdd when action is 'add'", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 42,
      action: "add",
      flags: ["\\Seen"],
    })

    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Seen"], {
      uid: true,
    })
    expect(mockClient.messageFlagsRemove).not.toHaveBeenCalled()
  })

  it("calls messageFlagsRemove when action is 'remove'", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 42,
      action: "remove",
      flags: ["\\Flagged"],
    })

    expect(mockClient.messageFlagsRemove).toHaveBeenCalledWith(
      "42",
      ["\\Flagged"],
      { uid: true },
    )
    expect(mockClient.messageFlagsAdd).not.toHaveBeenCalled()
  })

  it("passes uid as string to messageFlagsAdd", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 99,
      action: "add",
      flags: ["\\Seen"],
    })

    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(
      "99",
      expect.any(Array),
      expect.any(Object),
    )
  })

  it("passes all flags to messageFlagsAdd", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 1,
      action: "add",
      flags: ["\\Seen", "\\Flagged", "\\Answered"],
    })

    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(
      "1",
      ["\\Seen", "\\Flagged", "\\Answered"],
      { uid: true },
    )
  })

  it("opens the specified mailbox with getMailboxLock", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "Sent", uid: 1, action: "add", flags: ["\\Seen"] })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("Sent")
  })

  it("releases mailbox lock after adding flags", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 1,
      action: "add",
      flags: ["\\Seen"],
    })

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("releases mailbox lock when messageFlagsAdd throws", async () => {
    mockClient.messageFlagsAdd = vi
      .fn()
      .mockRejectedValue(new Error("Flags error"))

    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({ mailbox: "INBOX", uid: 1, action: "add", flags: ["\\Seen"] }),
    ).rejects.toThrow("Flags error")

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("releases mailbox lock when messageFlagsRemove throws", async () => {
    mockClient.messageFlagsRemove = vi
      .fn()
      .mockRejectedValue(new Error("Remove error"))

    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({
        mailbox: "INBOX",
        uid: 1,
        action: "remove",
        flags: ["\\Seen"],
      }),
    ).rejects.toThrow("Remove error")

    expect(mockLock.release).toHaveBeenCalled()
  })

  it("calls client.connect() and client.logout() on success", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      mailbox: "INBOX",
      uid: 1,
      action: "add",
      flags: ["\\Seen"],
    })

    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({ mailbox: "INBOX", uid: 1, action: "add", flags: ["\\Seen"] }),
    ).rejects.toThrow("Connection refused")

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("returns confirmation message for add action", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({
      mailbox: "INBOX",
      uid: 42,
      action: "add",
      flags: ["\\Seen", "\\Flagged"],
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toContain("added to")
    expect(result.content[0].text).toContain("42")
    expect(result.content[0].text).toContain("\\Seen")
    expect(result.content[0].text).toContain("\\Flagged")
  })

  it("returns confirmation message for remove action", async () => {
    registerFlagEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({
      mailbox: "INBOX",
      uid: 7,
      action: "remove",
      flags: ["\\Deleted"],
    })

    expect(result.content[0].text).toContain("removed from")
    expect(result.content[0].text).toContain("7")
    expect(result.content[0].text).toContain("\\Deleted")
  })
})
