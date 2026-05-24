"use client";

import type { ReactNode } from "react";
import React from "react";
import { useFormStatus } from "react-dom";

interface ManagementSubmitButtonProps {
  children: ReactNode;
  pendingLabel: string;
  disabled?: boolean;
}

export function ManagementSubmitButton({
  children,
  pendingLabel,
  disabled = false
}: ManagementSubmitButtonProps) {
  const status = useFormStatus();
  const isPending = status.pending;
  return (
    <button
      type="submit"
      className="managementSubmitButton"
      disabled={disabled || isPending}
      aria-busy={isPending ? true : undefined}
    >
      {isPending ? pendingLabel : children}
    </button>
  );
}
