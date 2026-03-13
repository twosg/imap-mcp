import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod/v4"
import { ImapFlow } from "imapflow"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerCreateDraft } from "./create-draft.js"

vi.mock("imapflow")

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

describe("create-draft input validation", () => {
  it("accepts valid input", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test Subject",
      body: "Hello World",
      from: "sender@example.com",
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid email in 'to' field", () => {
    const result = inputSchema.safeParse({
      to: "not-an-email",
      subject: "Test",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid email in 'from' field", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
      from: "not-an-email",
    })
    expect(result.success).toBe(false)
  })

  it("rejects CRLF injection in subject", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test\r\nBcc: attacker@evil.com",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects LF injection in subject", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test\nBcc: attacker@evil.com",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects CR injection in subject", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test\rBcc: attacker@evil.com",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects CRLF injection via 'to' field (email validation)", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com\r\nBcc: attacker@evil.com",
      subject: "Test",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects CRLF injection via 'from' field (email validation)", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
      from: "sender@example.com\r\nBcc: attacker@evil.com",
    })
    expect(result.success).toBe(false)
  })

  it("rejects subject exceeding max length", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "x".repeat(999),
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("rejects body exceeding max length", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test",
      body: "x".repeat(1_000_001),
    })
    expect(result.success).toBe(false)
  })

  it("rejects email with leading/trailing whitespace", () => {
    const result = inputSchema.safeParse({
      to: "  user@example.com  ",
      subject: "Test",
      body: "Hello",
    })
    expect(result.success).toBe(false)
  })

  it("accepts input without optional 'from' field", () => {
    const result = inputSchema.safeParse({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.from).toBeUndefined()
    }
  })
})

describe("registerCreateDraft", () => {
  let mockClient: ImapFlow
  let mockServer: McpServer

  beforeEach(() => {
    mockClient = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      append: vi
        .fn<
          (
            path: string,
            content: string,
            flags?: string[],
          ) => Promise<{ uid?: number }>
        >()
        .mockResolvedValue({ uid: 1 }),
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

  it("registers a tool named 'create-draft'", () => {
    registerCreateDraft(mockClient, mockServer)

    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "create-draft",
      expect.objectContaining({
        description: "Creates a draft email message",
      }),
      expect.any(Function),
    )
  })

  it("uses configured IMAP_DRAFTS_FOLDER", async () => {
    process.env.IMAP_DRAFTS_FOLDER = "Custom.Drafts"
    registerCreateDraft(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    })

    expect(mockClient.append).toHaveBeenCalledWith(
      "Custom.Drafts",
      expect.any(String),
      ["\\Draft"],
    )
    expect(result.content[0].text).toContain("user@example.com")

    delete process.env.IMAP_DRAFTS_FOLDER
  })

  it("falls back to 'Drafts' when primary folder fails", async () => {
    mockClient.append = vi
      .fn()
      .mockRejectedValueOnce(new Error("Mailbox not found"))
      .mockResolvedValueOnce({ uid: 1 })

    registerCreateDraft(mockClient, mockServer)

    const handler = getToolHandler()
    const result = await handler({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    })

    expect(mockClient.append).toHaveBeenCalledTimes(2)
    expect(mockClient.append).toHaveBeenNthCalledWith(
      2,
      "Drafts",
      expect.any(String),
      ["\\Draft"],
    )
    expect(result.content[0].text).toContain("user@example.com")
  })

  it("calls client.logout() after successful draft creation", async () => {
    registerCreateDraft(mockClient, mockServer)

    const handler = getToolHandler()
    await handler({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    })

    expect(mockClient.logout).toHaveBeenCalled()
  })

  it("calls client.logout() on connection error", async () => {
    mockClient.connect = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"))

    registerCreateDraft(mockClient, mockServer)

    const handler = getToolHandler()
    await expect(
      handler({
        to: "user@example.com",
        subject: "Test",
        body: "Hello",
      }),
    ).rejects.toThrow("Connection refused")

    expect(mockClient.logout).toHaveBeenCalled()
  })
})
