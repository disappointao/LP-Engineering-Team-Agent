import { describe, expect, it, vi } from "vitest";
import { useFormStatus } from "react-dom";
import { ManagementSubmitButton } from "./management-submit-button";

vi.mock("react-dom", () => ({
  useFormStatus: vi.fn()
}));

function formStatus(status: Record<string, unknown>): ReturnType<typeof useFormStatus> {
  return status as unknown as ReturnType<typeof useFormStatus>;
}

describe("ManagementSubmitButton", () => {
  it("renders children and stays enabled while idle", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: false,
      data: null,
      method: null,
      action: null
    }));

    const element = ManagementSubmitButton({
      children: "Save route",
      pendingLabel: "Saving route..."
    });

    expect(element.props.children).toBe("Save route");
    expect(element.props.disabled).toBe(false);
    expect(element.props["aria-busy"]).toBeUndefined();
  });

  it("renders the pending label, disables the button, and marks it busy while submitting", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: true,
      data: null,
      method: "POST",
      action: async () => {}
    }));

    const element = ManagementSubmitButton({
      children: "Create draft",
      pendingLabel: "Saving draft..."
    });

    expect(element.props.children).toBe("Saving draft...");
    expect(element.props.disabled).toBe(true);
    expect(element.props["aria-busy"]).toBe(true);
  });

  it("honors an explicit disabled prop while keeping the idle label when not pending", () => {
    vi.mocked(useFormStatus).mockReturnValue(formStatus({
      pending: false,
      data: null,
      method: null,
      action: null
    }));

    const element = ManagementSubmitButton({
      children: "Save route",
      pendingLabel: "Saving route...",
      disabled: true
    });

    expect(element.props.children).toBe("Save route");
    expect(element.props.disabled).toBe(true);
    expect(element.props["aria-busy"]).toBeUndefined();
  });
});
