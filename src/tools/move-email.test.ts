import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerMoveEmail } from "./move-email.js"

vi.mock("imapflow")

const inputSchema = z.object({
  mailbox: z.string().default("INBOX"),
  uid: z.number().int().positive(),
  destination: z.string().min(1),
})

describe("move-email input validation", () => {
  it("accepts valid input with all fields", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: 123,
      destination: "Archive",
    })
    expect(result.success).toBe(true)
  })

  it("uses INBOX as default mailbox", () => {
    const result = inputSchema.safeParse({
      uid: 123,
      destination: "Archive",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mailbox).toBe("INBOX")
    }
  })

  it("rejects non-integer uid", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: 1.5,
      destination: "Archive",
    })
    expect(result.success).toBe(false)
  })

  it("rejects zero uid", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: 0,
      destination: "Archive",
    })
    expect(result.success).toBe(false)
  })

  it("rejects negative uid", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: -1,
      destination: "Archive",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing uid", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      destination: "Archive",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty destination", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: 123,
      destination: "",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing destination", () => {
    const result = inputSchema.safeParse({
      mailbox: "INBOX",
      uid: 123,
    })
    expect(result.success).toBe(false)
  })
})

describe("registerMoveEmail", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer
  let mockLock: { release: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockLock = { release: vi.fn() }

    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getMailboxLock: vi
        .fn<(mailbox: string) => Promise<typeof mockLock>>()
        .mockResolvedValue(mockLock),
      messageMove: vi
        .fn<
          (
            range: string,
            destination: string,
            options: { uid: boolean },
          ) => Promise<{ destination: string; uidMap: Map<number, number> }>
        >()
        .mockResolvedValue({
          destination: "Archive",
          uidMap: new Map([[123, 456]]),
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

  it("registers a tool named 'move-email'", () => {
    registerMoveEmail(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "move-email",
      expect.objectContaining({
        description: "Moves an email message to a different mailbox folder",
      }),
      expect.any(Function),
    )
  })

  it("returns confirmation message with uid and destination on success", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({
      mailbox: "INBOX",
      uid: 123,
      destination: "Archive",
    })

    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Message 123 moved to Archive")
  })

  it("calls client.connect() before performing the move", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", uid: 123, destination: "Archive" })

    expect(mockClient.connect).toHaveBeenCalledOnce()
  })

  it("opens the specified mailbox lock", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX.Sent", uid: 123, destination: "Archive" })

    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX.Sent")
  })

  it("calls messageMove with string uid and uid option", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", uid: 123, destination: "Archive" })

    expect(mockClient.messageMove).toHaveBeenCalledWith("123", "Archive", {
      uid: true,
    })
  })

  it("releases the mailbox lock after successful move", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", uid: 123, destination: "Archive" })

    expect(mockLock.release).toHaveBeenCalledOnce()
  })

  it("releases the mailbox lock when messageMove fails", async () => {
    mockClient.messageMove = vi.fn().mockRejectedValue(new Error("MOVE failed"))

    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({ mailbox: "INBOX", uid: 123, destination: "Archive" }),
    ).rejects.toThrow("MOVE failed")

    expect(mockLock.release).toHaveBeenCalledOnce()
  })

  it("calls client.logout() after successful move", async () => {
    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({ mailbox: "INBOX", uid: 123, destination: "Archive" })

    expect(mockClient.logout).toHaveBeenCalledOnce()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({ mailbox: "INBOX", uid: 123, destination: "Archive" }),
    ).rejects.toThrow("Connection refused")

    expect(mockClient.logout).toHaveBeenCalledOnce()
  })

  it("calls client.logout() when messageMove fails", async () => {
    mockClient.messageMove = vi.fn().mockRejectedValue(new Error("MOVE failed"))

    registerMoveEmail(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({ mailbox: "INBOX", uid: 123, destination: "Archive" }),
    ).rejects.toThrow("MOVE failed")

    expect(mockClient.logout).toHaveBeenCalledOnce()
  })
})
