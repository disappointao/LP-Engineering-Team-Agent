"use client";

import React from "react";
import { useFormStatus } from "react-dom";

interface InterruptSubmitButtonProps {
  action: (formData: FormData) => Promise<void>;
  available: boolean;
  labels: {
    idle: string;
    stopping: string;
    unavailable: string;
  };
}

export function InterruptSubmitButton({
  action,
  available,
  labels
}: InterruptSubmitButtonProps) {
  const status = useFormStatus();
  const isInterruptPending = status.pending && status.action === action;
  const disabled = !available || status.pending;
  return (
    <button
      type="submit"
      formAction={action}
      className="interruptButton"
      disabled={disabled}
      aria-busy={isInterruptPending ? true : undefined}
      title={!available ? labels.unavailable : undefined}
    >
      {isInterruptPending ? labels.stopping : available ? labels.idle : labels.unavailable}
    </button>
  );
}
