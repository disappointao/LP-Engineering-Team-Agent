"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { LPPreview } from "../components/lp-preview";
import type { ArtifactExportDescriptor } from "../lib/export-links";
import { appendPreviewInspectorQuery } from "../lib/lp-preview-html";
import {
  selectedPreviewElementChangeEvent,
  sanitizeSelectedPreviewElement,
  type SelectedPreviewElement
} from "../lib/selected-preview-element";

export interface LPPreviewWorkspaceLabels {
  clearSelectedElement: string;
  close: string;
  exportTitle: string;
  inspect: string;
  inspectActive: string;
  open: string;
  previewTitle: string;
  selectedElementEmpty: string;
  selectedElementLabel: string;
}

export interface LPPreviewWorkspaceExportLink {
  label: string;
  filename: string;
  href: string;
  bytes?: number;
}

export function LPPreviewWorkspace({
  artifacts,
  exportDescriptors = [],
  exportLinks = [],
  previewUrl,
  previewVersionKey,
  labels
}: {
  artifacts?: StaticArtifacts;
  exportDescriptors?: ArtifactExportDescriptor[];
  exportLinks?: LPPreviewWorkspaceExportLink[];
  previewUrl?: string;
  previewVersionKey?: string;
  labels: LPPreviewWorkspaceLabels;
}) {
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [routePreviewHtml, setRoutePreviewHtml] = useState<string | undefined>();
  const [selectedElement, setSelectedElement] = useState<SelectedPreviewElement | undefined>();
  const downloadLinks = useMemo<LPPreviewWorkspaceExportLink[]>(
    () => [
      ...exportLinks,
      ...exportDescriptors.map((descriptor) => ({
        ...descriptor,
        href: createDataHref(descriptor)
      }))
    ],
    [exportDescriptors, exportLinks]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        typeof event.data !== "object" ||
        event.data === null ||
        Array.isArray(event.data) ||
        event.data.type !== "lp-preview-element-selected"
      ) {
        return;
      }
      const data = sanitizeSelectedPreviewElement(event.data);
      if (!data) {
        return;
      }
      setSelectedElement(data);
      window.dispatchEvent(
        new CustomEvent(selectedPreviewElementChangeEvent, { detail: data })
      );
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!isOpen || !previewUrl) {
      return;
    }

    const controller = new AbortController();
    const routeUrl = inspectMode
      ? appendPreviewInspectorQuery(previewUrl)
      : previewUrl;
    setRoutePreviewHtml(createPreviewStatusDocument("正在准备预览..."));

    void fetch(routeUrl, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview request failed with ${response.status}`);
        }
        return response.text();
      })
      .then((html) => {
        setRoutePreviewHtml(html);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Preview request failed.";
        setRoutePreviewHtml(createPreviewStatusDocument(`预览加载失败：${message}`));
      });

    return () => controller.abort();
  }, [inspectMode, isOpen, previewUrl]);

  const clearSelectedElement = () => {
    setSelectedElement(undefined);
    window.dispatchEvent(
      new CustomEvent(selectedPreviewElementChangeEvent, { detail: undefined })
    );
  };

  return (
    <div
      className={isOpen ? "lpPreviewWorkspace lpPreviewWorkspaceOpen" : "lpPreviewWorkspace"}
    >
      <button
        aria-expanded={isOpen}
        className="artifactCard lpPreviewWorkspaceTrigger agentPreviewTrigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span>{labels.previewTitle}</span>
        <strong>{labels.open}</strong>
        <small>{labels.exportTitle}</small>
      </button>
      {isOpen ? (
        <aside
          aria-labelledby={titleId}
          className="lpPreviewWorkspacePanel"
          data-testid="lp-preview-workspace-panel"
        >
          <header className="lpPreviewWorkspaceHeader">
            <div>
              <h2 id={titleId}>{labels.previewTitle}</h2>
              <p>{selectedElement ? formatSelectedElement(selectedElement) : labels.selectedElementEmpty}</p>
            </div>
            <div className="lpPreviewWorkspaceHeaderActions">
              {downloadLinks.length > 0 ? (
                <details className="lpPreviewExportMenu">
                  <summary>{labels.exportTitle}</summary>
                  <div className="lpPreviewExportMenuList">
                    {downloadLinks.map((link) => (
                      <a
                        className="lpPreviewExportMenuLink"
                        download={link.filename}
                        href={link.href}
                        key={link.filename}
                      >
                        <span>{link.label}</span>
                        <small>
                          {link.bytes !== undefined
                            ? `${link.filename} · ${link.bytes.toLocaleString()} bytes`
                            : link.filename}
                        </small>
                      </a>
                    ))}
                  </div>
                </details>
              ) : null}
              <button
                className="lpPreviewWorkspaceClose"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                {labels.close}
              </button>
            </div>
          </header>

          <div className="lpPreviewWorkspaceToolbar">
            <button
              aria-pressed={inspectMode}
              className={inspectMode ? "lpPreviewInspectToggle lpPreviewInspectToggleActive" : "lpPreviewInspectToggle"}
              onClick={() => setInspectMode((current) => !current)}
              type="button"
            >
              {inspectMode ? labels.inspectActive : labels.inspect}
            </button>
            {selectedElement ? (
              <button
                className="lpPreviewClearSelection"
                onClick={clearSelectedElement}
                type="button"
              >
                {labels.clearSelectedElement}
              </button>
            ) : null}
          </div>

          {selectedElement ? (
            <div className="lpPreviewSelectedElement" role="status">
              <span>{labels.selectedElementLabel}</span>
              <strong>{formatSelectedElement(selectedElement)}</strong>
            </div>
          ) : null}

          <div className="lpPreviewWorkspaceFrame">
            {previewUrl ? (
              <LPPreview
                inspectMode={inspectMode}
                key={`${previewVersionKey ?? previewUrl}:${inspectMode ? "inspect" : "plain"}`}
                previewHtml={routePreviewHtml ?? createPreviewStatusDocument("正在准备预览...")}
              />
            ) : artifacts ? (
              <LPPreview artifacts={artifacts} inspectMode={inspectMode} />
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function createDataHref(descriptor: ArtifactExportDescriptor): string {
  return `data:${descriptor.mimeType};charset=utf-8,${encodeURIComponent(descriptor.content)}`;
}

function formatSelectedElement(element: SelectedPreviewElement): string {
  const text = element.text ? ` · ${element.text}` : "";
  return `${element.tagName}${element.selector ? ` ${element.selector}` : ""}${text}`;
}

function createPreviewStatusDocument(message: string): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<style>",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#475569;background:#f8fafc;}",
    "p{margin:0;padding:16px 18px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.08);}",
    "</style>",
    "</head>",
    `<body><p>${escapeHtml(message)}</p></body>`,
    "</html>"
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
