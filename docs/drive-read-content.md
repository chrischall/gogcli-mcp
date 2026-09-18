# Reading Drive file content (PDFs, images, docs)

A Drive file — including a PDF delivered by `gog_gmail_attachment`
(`deliveredVia:"drive"`) — used to be a dead end: viewable by a human via
`webViewLink`, but unreadable by the assistant. Two tools close that gap.

## `gog_drive_extract_text` — readable text (preferred)

Given a Drive file id, returns the file's **text**:

- **Native Google Doc** → exported straight to `text/plain` (Drive API `files.export`).
- **PDF / image / docx / …** → copied *with conversion* to a temporary Google Doc
  (`files.copy` targeting `application/vnd.google-apps.document`), which makes **Drive run OCR**
  (so scanned PDFs work too); the temp Doc is exported to text and then **permanently deleted** —
  in a `finally`, so it's cleaned up even if extraction fails midway.

Pass `ocrLanguage` (BCP-47) to hint OCR for scanned/image PDFs. Page through large files with
`offset` / `maxChars`. The response reports `name`, `mimeType`, `extractedVia`
(`native-export` | `ocr-convert`), `totalChars`, `offset`, `returnedChars`, and `truncated`.

It runs **entirely through the Drive API within the existing drive scope** — no host filesystem,
no scope widening — so it works on the local stdio server *and* a hosted connector.
(`pageCount` isn't reported: Drive exposes no PDF page count via this path, and the
converted Doc loses it — `offset`/`maxChars` bound the response instead.)

```
gog_drive_extract_text(fileId="1keK…", maxChars=4000)
gog_gmail_attachment(...) → deliveredVia:"drive", id → gog_drive_extract_text(fileId=id)
```

## `gog_drive_read_bytes` — raw bytes (fallback)

Returns the file's raw bytes base64-encoded as an MCP embedded resource, for callers that want the
file itself rather than extracted text.

**Binary path:** the wrapper's runner utf8-decodes gog's stdout (which would corrupt binary), so
bytes are captured via a dedicated path (`runBinary`) that base64-encodes raw stdout. Both the
local stdio server and a hosted mcp-host connector spawn `gog` locally, so this works on either;
a client that cannot render a non-image resource is pointed at `gog_drive_extract_text`.

## Why not `gog drive download`?

`gog drive download --out` writes to the **host** filesystem (unwritable/unreachable on the
connector, and not retrievable by the caller). Both tools above avoid the host FS entirely.
