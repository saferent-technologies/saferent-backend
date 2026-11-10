import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { Input, type InputProps } from "./Input";

export function PasswordInput(props: Omit<InputProps, "type" | "rightSlot">) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      leftIcon={props.leftIcon ?? <Lock className="size-4" />}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      rightSlot={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      }
    />
  );
}
