import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactFaceSwapCallButton } from "./contact-face-swap-call-button";

describe("ContactFaceSwapCallButton", () => {
  it("renders no contact face-swap entry without the full-feature gate", () => {
    render(
      <ContactFaceSwapCallButton
        allowed={false}
        busy={false}
        label="Face Swap Call"
        onStart={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Face Swap Call" }),
    ).not.toBeInTheDocument();
  });

  it("starts the dedicated call action for a full-feature user", () => {
    const onStart = vi.fn();
    render(
      <ContactFaceSwapCallButton
        allowed
        busy={false}
        label="Face Swap Call"
        onStart={onStart}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Face Swap Call" }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("cannot start a second call while preflight or signaling is busy", () => {
    const onStart = vi.fn();
    render(
      <ContactFaceSwapCallButton
        allowed
        busy
        label="Face Swap Call"
        onStart={onStart}
      />,
    );

    const button = screen.getByRole("button", { name: "Face Swap Call" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });
});
