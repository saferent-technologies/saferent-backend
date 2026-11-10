import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/utils/cn";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are entered (typed or pasted). */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
}

/**
 * Six separate boxes with auto-advance, backspace navigation, arrow keys, full-code paste
 * and SMS/email one-time-code autofill (iOS/Android).
 */
export function OtpInput({ value, onChange, onComplete, length = 6, disabled, invalid, autoFocus = true, label = "Verification code" }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (autoFocus && !disabled) refs.current[Math.min(value.length, length - 1)]?.focus();
    // Focus only on mount / when re-enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const focus = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  const handleInput = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    if (typed.length > 1) {
      // Autofill or paste into a single box: spread across boxes starting here.
      commit(value.slice(0, index) + typed);
      focus(index + typed.length);
      return;
    }
    const chars = digits.slice();
    chars[index] = typed;
    commit(chars.join("").slice(0, length));
    if (index < length - 1) focus(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Backspace": {
        event.preventDefault();
        const chars = digits.slice();
        if (chars[index]) {
          chars[index] = "";
          commit(chars.join(""));
        } else if (index > 0) {
          chars[index - 1] = "";
          commit(chars.join(""));
          focus(index - 1);
        }
        break;
      }
      case "ArrowLeft":
        event.preventDefault();
        focus(index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        focus(index + 1);
        break;
      case "Home":
        event.preventDefault();
        focus(0);
        break;
      case "End":
        event.preventDefault();
        focus(length - 1);
        break;
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    commit(pasted);
    focus(pasted.length);
  };

  return (
    <div role="group" aria-label={label} className="flex w-full justify-between gap-2 sm:justify-center sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digit}
          onChange={(e) => handleInput(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={index === 0 ? length : 1}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "aspect-[5/6] w-full min-w-0 max-w-14 rounded-control border bg-surface text-center text-xl font-bold text-ink transition-shadow sm:text-2xl",
            "focus:border-brand focus:shadow-focus focus:outline-none disabled:bg-subtle",
            invalid ? "border-danger" : digit ? "border-brand-light" : "border-line",
          )}
        />
      ))}
    </div>
  );
}
