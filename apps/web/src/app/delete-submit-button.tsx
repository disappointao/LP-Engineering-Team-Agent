"use client";

import type { ReactNode } from "react";
import React from "react";
import { useFormStatus } from "react-dom";

interface DeleteSubmitButtonProps {
  ariaLabel: string;
  children: ReactNode;
  confirmMessage: string;
  pendingLabel: string;
}

export function DeleteSubmitButton({
  ariaLabel,
  children,
  confirmMessage,
  pendingLabel
}: DeleteSubmitButtonProps) {
  const status = useFormStatus();
  const isPending = status.pending;

  return (
    <button
      type="submit"
      className="sidebarDeleteButton"
      disabled={isPending}
      aria-busy={isPending ? true : undefined}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {isPending ? pendingLabel : children}
    </button>
  );
}
