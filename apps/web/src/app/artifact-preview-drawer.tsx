"use client";

import React, { useEffect, useId, useState } from "react";

export interface ArtifactPreviewDrawerDownloadLink {
  bytesLabel: string;
  filename: string;
  href: string;
  label: string;
}

export interface ArtifactPreviewDrawerLabels {
  close: string;
  exportTitle: string;
  open: string;
  previewTitle: string;
}

export function ArtifactPreviewDrawer({
  children,
  downloadLinks,
  labels
}: {
  children: React.ReactNode;
  downloadLinks: ArtifactPreviewDrawerDownloadLink[];
  labels: ArtifactPreviewDrawerLabels;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        aria-expanded={isOpen}
        className="artifactCard artifactPreviewDrawerTrigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span>{labels.previewTitle}</span>
        <strong>{labels.open}</strong>
        <small>{labels.exportTitle}</small>
      </button>
      {isOpen ? (
        <div className="artifactPreviewDrawerLayer">
          <button
            aria-label={labels.close}
            className="artifactPreviewDrawerBackdrop"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <aside
            aria-labelledby={titleId}
            aria-modal="true"
            className="artifactPreviewDrawerPanel"
            role="dialog"
          >
            <header className="artifactPreviewDrawerHeader">
              <h2 id={titleId}>{labels.previewTitle}</h2>
              <button
                className="artifactPreviewDrawerClose"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                {labels.close}
              </button>
            </header>
            <div className="artifactPreviewDrawerPreview">{children}</div>
            <section
              className="artifactPreviewDrawerExports"
              aria-labelledby={`${titleId}-exports`}
            >
              <h3 id={`${titleId}-exports`}>{labels.exportTitle}</h3>
              <div className="artifactGrid artifactWorkspaceExportGrid">
                {downloadLinks.map((link) => (
                  <a
                    className="artifactCard"
                    download={link.filename}
                    href={link.href}
                    key={link.filename}
                  >
                    <span>{link.label}</span>
                    <strong>{link.filename}</strong>
                    <small>{link.bytesLabel}</small>
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}
