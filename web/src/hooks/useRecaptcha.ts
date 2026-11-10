import type { RecaptchaVerifier } from "firebase/auth";
import { useCallback, useEffect, useRef } from "react";
import { createRecaptcha } from "@/services/authService";

/**
 * Manages an invisible reCAPTCHA verifier for Firebase Phone Auth.
 * `getVerifier()` returns a fresh verifier (required after a failed attempt or for "Resend").
 */
export function useRecaptcha(containerId: string) {
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  const reset = useCallback(() => {
    verifierRef.current?.clear();
    verifierRef.current = null;
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = "";
  }, [containerId]);

  const getVerifier = useCallback(() => {
    reset();
    verifierRef.current = createRecaptcha(containerId);
    return verifierRef.current;
  }, [containerId, reset]);

  useEffect(() => reset, [reset]);

  return { getVerifier, reset };
}
