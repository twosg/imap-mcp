import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ImapFlow } from "imapflow"

vi.mock("@modelcontextprotocol/sdk/server/mcp.js")
vi.mock("@modelcontextprotocol/sdk/server/stdio.js")
vi.mock("imapflow")
vi.mock("./tools/create-draft.js", () => ({
  registerCreateDraft: vi.fn(),
}))
vi.mock("./tools/flag-email.js", () => ({
  registerFlagEmail: vi.fn(),
}))
vi.mock("./tools/list-emails.js", () => ({
  registerListEmails: vi.fn(),
}))
vi.mock("./tools/list-mailboxes.js", () => ({
  registerListMailboxes: vi.fn(),
}))
vi.mock("./tools/move-email.js", () => ({
  registerMoveEmail: vi.fn(),
}))
vi.mock("./tools/read-email.js", () => ({
  registerReadEmail: vi.fn(),
}))
vi.mock("./tools/search-emails.js", () => ({
  registerSearchEmails: vi.fn(),
}))

describe("main", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      IMAP_USERNAME: "test@example.com",
      IMAP_PASSWORD: "testpass",
      IMAP_HOST: "imap.example.com",
      IMAP_PORT: "993",
      IMAP_USE_SSL: "true",
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("starts the mcp server", async () => {
    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
    }
    const mockTransport = {}
    const mockImapFlow = {}

    vi.mocked(McpServer).mockImplementation(
      () => mockServer as unknown as McpServer,
    )
    vi.mocked(StdioServerTransport).mockImplementation(
      () => mockTransport as unknown as StdioServerTransport,
    )
    vi.mocked(ImapFlow).mockImplementation(
      () => mockImapFlow as unknown as ImapFlow,
    )

    const { main } = await import("./index.js")
    await main()

    expect(McpServer).toHaveBeenCalledWith({
      name: "imap-mcp",
      version: "1.0.0",
    })

    expect(ImapFlow).toHaveBeenCalledWith({
      host: "imap.example.com",
      port: 993,
      secure: true,
      auth: {
        user: "test@example.com",
        pass: "testpass",
      },
      tls: { rejectUnauthorized: true },
      logger: false,
    })

    expect(StdioServerTransport).toHaveBeenCalled()
    expect(mockServer.connect).toHaveBeenCalledWith(mockTransport)
  })

  it("throws when IMAP_HOST is missing", async () => {
    delete process.env.IMAP_HOST

    const { main } = await import("./index.js")
    await expect(main()).rejects.toThrow(
      "Missing required environment variable: IMAP_HOST",
    )
  })

  it("throws when IMAP_USERNAME is missing", async () => {
    delete process.env.IMAP_USERNAME

    const { main } = await import("./index.js")
    await expect(main()).rejects.toThrow(
      "Missing required environment variable: IMAP_USERNAME",
    )
  })

  it("throws when IMAP_PASSWORD is missing", async () => {
    delete process.env.IMAP_PASSWORD

    const { main } = await import("./index.js")
    await expect(main()).rejects.toThrow(
      "Missing required environment variable: IMAP_PASSWORD",
    )
  })

  it("throws for invalid port", async () => {
    process.env.IMAP_PORT = "99999"

    const { main } = await import("./index.js")
    await expect(main()).rejects.toThrow(
      "Invalid IMAP_PORT: must be a number between 1 and 65535",
    )
  })

  it("throws for non-numeric port", async () => {
    process.env.IMAP_PORT = "abc"

    const { main } = await import("./index.js")
    await expect(main()).rejects.toThrow(
      "Invalid IMAP_PORT: must be a number between 1 and 65535",
    )
  })

  it("enables TLS certificate validation by default", async () => {
    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(McpServer).mockImplementation(
      () => mockServer as unknown as McpServer,
    )
    vi.mocked(StdioServerTransport).mockImplementation(
      () => ({}) as unknown as StdioServerTransport,
    )
    vi.mocked(ImapFlow).mockImplementation(() => ({}) as unknown as ImapFlow)

    const { main } = await import("./index.js")
    await main()

    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        tls: { rejectUnauthorized: true },
      }),
    )
  })

  it("allows disabling TLS validation via env", async () => {
    process.env.IMAP_REJECT_UNAUTHORIZED = "false"

    const mockServer = {
      connect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(McpServer).mockImplementation(
      () => mockServer as unknown as McpServer,
    )
    vi.mocked(StdioServerTransport).mockImplementation(
      () => ({}) as unknown as StdioServerTransport,
    )
    vi.mocked(ImapFlow).mockImplementation(() => ({}) as unknown as ImapFlow)

    const { main } = await import("./index.js")
    await main()

    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        tls: { rejectUnauthorized: false },
      }),
    )
  })
})
