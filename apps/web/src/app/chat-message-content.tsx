"use client";

import React, { useState } from "react";

export type ChatMessageBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "unordered-list"; items: string[] }
  | { kind: "ordered-list"; items: string[] }
  | { kind: "code"; code: string; language: string };

export function parseChatMessageBlocks(content: string): ChatMessageBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatMessageBlock[] = [];
  const paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph.length = 0;
    if (text.length > 0) {
      blocks.push({ kind: "paragraph", text });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = trimmed.slice(3).trim().split(/\s+/)[0] ?? "";
      const codeLines: string[] = [];

      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push({
        code: codeLines.join("\n").replace(/\n$/, ""),
        kind: "code",
        language
      });
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      const items = [unorderedMatch[1] ?? ""];
      while (index + 1 < lines.length) {
        const nextMatch = (lines[index + 1] ?? "").trim().match(/^[-*]\s+(.+)$/);
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ items, kind: "unordered-list" });
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      const items = [orderedMatch[1] ?? ""];
      while (index + 1 < lines.length) {
        const nextMatch = (lines[index + 1] ?? "").trim().match(/^\d+[.)]\s+(.+)$/);
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ items, kind: "ordered-list" });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

export function ChatMessageContent({
  content,
  className
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseChatMessageBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={["messageContent", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: ChatMessageBlock, index: number) {
  if (block.kind === "paragraph") {
    return <p key={index}>{renderInlineText(block.text, `p-${index}`)}</p>;
  }

  if (block.kind === "unordered-list") {
    return (
      <ul key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}:${itemIndex}`}>{renderInlineText(item, `${index}:${itemIndex}`)}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "ordered-list") {
    return (
      <ol key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}:${itemIndex}`}>{renderInlineText(item, `${index}:${itemIndex}`)}</li>
        ))}
      </ol>
    );
  }

  return (
    <div className="codeBlock" key={index}>
      <div className="codeBlockHeader">
        <span>{block.language || "code"}</span>
        <CopyCodeButton code={block.code} />
      </div>
      <pre>
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

function renderInlineText(text: string, keyPrefix: string) {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const key = `${keyPrefix}:${index}`;
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code className="inlineCode" key={key}>
            {part.slice(1, -1)}
          </code>
        );
      }

      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }

      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className="copyCodeButton" onClick={copyCode} type="button">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
