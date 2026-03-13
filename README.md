# imap-mcp

<div align="center">

📧 An IMAP Model Context Protocol (MCP) server to expose IMAP operations as tools for AI assistants.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)

</div>

## ✨ Features

- **List Mailboxes**: Browse all available mailboxes with their special use flags
- **List Emails**: View the most recent emails in any mailbox
- **Read Emails**: Read full email content including headers and body
- **Search Emails**: Search emails by sender, recipient, subject, date range, and flags
- **Move Emails**: Move emails between mailboxes
- **Flag Emails**: Add or remove flags (Seen, Flagged, Answered, etc.)
- **Create Drafts**: Create draft emails saved to your IMAP server's drafts folder
- **IMAP Integration**: Connect to any IMAP-compatible email server (Gmail, Outlook, etc.)
- **Secure Authentication**: Uses environment variables for secure credential management
- **MCP Compatible**: Works with Claude and other AI assistants that support the Model Context Protocol
- **TypeScript**: Full TypeScript support with proper type definitions

## Setup

```
{
  "mcpServers": {
    ...,
    "imap": {
      "command": "npx",
      "args": [
        "imap-mcp"
      ],
      "env": {
        "IMAP_HOST": "<IMAP host>",
        "IMAP_PORT": "<IMAP port>",
        "IMAP_USERNAME": "<IMAP username>",
        "IMAP_PASSWORD": "<IMAP password>",
        "IMAP_USE_SSL": "<true or false>"
      }
    }
  }
}
```

## Usage

1. Compile TypeScript to JavaScript:
```bash
npx tsc
```

2. Run the MCP server:
```bash
node dist/index.js
```

## Available Tools

### `list-mailboxes`

Lists all available mailboxes on the IMAP server with their path, special use designation, flags, and subscription status.

**Parameters:** None

### `list-emails`

Lists the most recent emails from a mailbox.

**Parameters:**
- `mailbox` (string, optional): Mailbox to list (default: `"INBOX"`)
- `limit` (number, optional): Number of emails to return, 1–100 (default: `20`)

### `read-email`

Reads a single email by UID, returning full headers and body content.

**Parameters:**
- `mailbox` (string, optional): Mailbox containing the email (default: `"INBOX"`)
- `uid` (number, required): The UID of the email to read

### `search-emails`

Searches for emails using optional filter criteria.

**Parameters:**
- `mailbox` (string, optional): Mailbox to search (default: `"INBOX"`)
- `from` (string, optional): Filter by sender
- `to` (string, optional): Filter by recipient
- `subject` (string, optional): Filter by subject
- `since` (string, optional): Emails since this ISO date
- `before` (string, optional): Emails before this ISO date
- `seen` (boolean, optional): Filter by read/unread status
- `flagged` (boolean, optional): Filter by flagged status
- `limit` (number, optional): Maximum results, 1–100 (default: `20`)

### `move-email`

Moves an email to a different mailbox.

**Parameters:**
- `mailbox` (string, optional): Source mailbox (default: `"INBOX"`)
- `uid` (number, required): The UID of the email to move
- `destination` (string, required): Target mailbox path

### `flag-email`

Adds or removes flags on an email.

**Parameters:**
- `mailbox` (string, optional): Mailbox containing the email (default: `"INBOX"`)
- `uid` (number, required): The UID of the email
- `action` (string, required): `"add"` or `"remove"`
- `flags` (string[], required): Flags to modify (e.g., `\Seen`, `\Flagged`, `\Answered`, `\Draft`, `\Deleted`)

### `create-draft`

Creates a draft email message and saves it to the IMAP server's drafts folder.

**Parameters:**
- `to` (string, required): The recipient's email address
- `subject` (string, required): The email subject line
- `body` (string, required): The email body content
- `from` (string, optional): The sender's email address (defaults to IMAP_USERNAME)

## License

MIT