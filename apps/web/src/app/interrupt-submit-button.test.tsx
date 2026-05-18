import { describe, expect, it, vi } from "vitest";
import { useFormStatus } from "react-dom";
import { InterruptSubmitButton } from "./interrupt-submit-button";

vi.mock("react-dom", () => ({
  useFormStatus: vi.fn()
}));

const action = async (_formData: FormData) => {};
const otherAction = async (_formData: FormData) => {};
const labels = {
  idle: "Interrupt",
  stopping: "Stopping...",
  unavailable: "Nothing running"
};

function formStatus(status: Record<string, unknown>): ReturnType<typeof useFormStatus> {
  return status as unknown as ReturnType<typeof useFormStatus>;
}

describe("InterruptSubmitButton", () => {
  it("renders an enabled interrupt submit button when available", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: false,
      data: null,
      method: null,
      action: null
    }));

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Interrupt");
    expect(element.props.disabled).toBe(false);
    expect(element.props.formAction).toBe(action);
  });

  it("renders disabled unavailable state when no interrupt target exists", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: false,
      data: null,
      method: null,
      action: null
    }));

    const element = InterruptSubmitButton({ action, available: false, labels });

    expect(element.props.children).toBe("Nothing running");
    expect(element.props.disabled).toBe(true);
    expect(element.props.title).toBe("Nothing running");
  });

  it("renders optimistic stopping copy for the pending interrupt action", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: true,
      data: null,
      method: "POST",
      action
    }));

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Stopping...");
    expect(element.props.disabled).toBe(true);
    expect(element.props["aria-busy"]).toBe(true);
  });

  it("keeps idle copy when another form action is pending", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: true,
      data: null,
      method: "POST",
      action: otherAction
    }));

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Interrupt");
    expect(element.props.disabled).toBe(true);
  });
});
