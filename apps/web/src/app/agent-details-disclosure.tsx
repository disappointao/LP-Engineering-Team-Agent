"use client";

import React, { useEffect, useRef, useState } from "react";

export function AgentDetailsDisclosure({
  children,
  countLabel,
  storageKey,
  title
}: {
  children: React.ReactNode;
  countLabel: string;
  storageKey: string;
  title: string;
}) {
  const [didReadStoredState, setDidReadStoredState] = useState(false);
  const [open, setOpen] = useState(false);
  const didInteractRef = useRef(false);

  useEffect(() => {
    if (!didInteractRef.current) {
      setOpen(sessionStorage.getItem(storageKey) === "open");
    }
    setDidReadStoredState(true);
  }, [storageKey]);

  useEffect(() => {
    if (!didReadStoredState) {
      return;
    }
    sessionStorage.setItem(storageKey, open ? "open" : "closed");
  }, [didReadStoredState, open, storageKey]);

  return (
    <section className="agentDetails" data-open={open ? "true" : "false"}>
      <button
        aria-expanded={open}
        className="agentDetailsSummary"
        disabled={!didReadStoredState}
        onClick={() => {
          didInteractRef.current = true;
          setOpen((current) => {
            const nextOpen = !current;
            try {
              sessionStorage.setItem(storageKey, nextOpen ? "open" : "closed");
            } catch {
              // Storage can be unavailable in hardened browser contexts; the toggle should still work.
            }
            return nextOpen;
          });
        }}
        type="button"
      >
        <span>{title}</span>
        <small>{countLabel}</small>
      </button>
      <div aria-hidden={!open} className="agentDetailsBody">
        {children}
      </div>
    </section>
  );
}
