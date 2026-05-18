"use client";

import React from "react";
import { useFormStatus } from "react-dom";

interface InterruptSubmitButtonProps {
  action: (formData: FormData) => Promise<void>;
  state: "idle" | "stopping" | "cancelled" | "not_interruptible";
  labels: {
    idle: string;
    stopping: string;
    unavailable: string;
  };
}

export function InterruptSubmitButton({
  action,
  state,
  labels
}: InterruptSubmitButtonProps) {
  const status = useFormStatus();
  const isInterruptPending = status.pending && status.action === action;
  const isPersistedStopping = state === "stopping";
  const isAvailable = state === "idle";
  const disabled = !isAvailable || status.pending;
  const isBusy = isInterruptPending || isPersistedStopping;
  return (
    <button
      type="submit"
      formAction={action}
      className="interruptButton"
      disabled={disabled}
      aria-busy={isBusy ? true : undefined}
      title={!isAvailable && !isPersistedStopping ? labels.unavailable : undefined}
    >
      {isInterruptPending || isPersistedStopping
        ? labels.stopping
        : isAvailable
          ? labels.idle
          : labels.unavailable}
    </button>
  );
}
