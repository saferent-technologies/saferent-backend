import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpInput } from "@/components/ui/OtpInput";

function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole("textbox");

describe("OtpInput", () => {
  it("renders six boxes and focuses the first", () => {
    render(<Harness />);
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0]).toHaveFocus();
  });

  it("auto-advances while typing and reports completion", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.keyboard("123456");
    expect(screen.getByTestId("value")).toHaveTextContent("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("supports pasting the full code", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => "98 76-54" } });
    expect(screen.getByTestId("value")).toHaveTextContent("987654");
    expect(onComplete).toHaveBeenCalledWith("987654");
  });

  it("moves back on backspace from an empty box", async () => {
    render(<Harness />);
    await userEvent.keyboard("12");
    expect(boxes()[2]).toHaveFocus();
    await userEvent.keyboard("{Backspace}");
    expect(screen.getByTestId("value")).toHaveTextContent(/^1$/);
    expect(boxes()[1]).toHaveFocus();
  });

  it("ignores non-digits", async () => {
    render(<Harness />);
    await userEvent.keyboard("a1b");
    expect(screen.getByTestId("value")).toHaveTextContent(/^1$/);
  });
});
