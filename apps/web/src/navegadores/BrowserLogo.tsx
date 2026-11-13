// NAVEGADORES-2: el logo de cada navegador, dibujado aquí (sin red ni paquete de iconos): Chrome, Edge, Brave, Firefox.
import { useId } from "react";

export type BrowserKind = "chrome" | "edge" | "brave" | "firefox";

export function BrowserLogo({ browser, size = 16 }: { browser: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const common = { width: size, height: size, viewBox: "0 0 48 48", "aria-hidden": true, focusable: false, className: "browser-logo" } as const;
  if (browser === "chrome")
    return (
      <svg {...common}>
        <path fill="#EA4335" d="M24 24 6.68 14A20 20 0 0 1 41.32 14Z" />
        <path fill="#FBBC04" d="M24 24 41.32 14A20 20 0 0 1 24 44Z" />
        <path fill="#34A853" d="M24 24 24 44A20 20 0 0 1 6.68 14Z" />
        <circle cx="24" cy="24" r="9.5" fill="#fff" />
        <circle cx="24" cy="24" r="7.5" fill="#4285F4" />
      </svg>
    );
  if (browser === "edge")
    return (
      <svg {...common}>
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0C59A4" />
            <stop offset="1" stopColor="#1B9DE2" />
          </linearGradient>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#35C1F1" />
            <stop offset="1" stopColor="#66EB6E" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="20" fill={`url(#${id}a)`} />
        <path
          fill={`url(#${id}b)`}
          d="M4.3 21C6 11.4 14.2 4 24 4c10.6 0 19.5 8.2 20 18.5.3 5.6-3.9 9.5-9.4 9.5H21.5c0 4.6 4.6 8 10.1 8 3.3 0 6.4-1 8.9-2.9C36.9 42 30.9 44.5 24.4 44 15 43.2 11 36.4 11 30.5 11 24.7 15.6 20 21.4 20c5.2 0 8.3 3.1 8.3 6.3H18.4c-.4-6.3-6.8-9.4-14.1-5.3Z"
        />
      </svg>
    );
  if (browser === "brave")
    return (
      <svg {...common}>
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF6A00" />
            <stop offset="1" stopColor="#FF2000" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${id}a)`}
          d="M24 3.5 30.5 5l3.5-1.5 5 4.5-1 3.5 2.5 3-.9 4L41 22l-3.4 12.6c-.7 2.6-2.3 4.8-4.5 6.3L26.6 45c-1.6 1.1-3.6 1.1-5.2 0l-6.5-4.1c-2.2-1.5-3.8-3.7-4.5-6.3L7 22l1.4-3.5-.9-4 2.5-3-1-3.5 5-4.5L17.5 5Z"
        />
        <path
          fill="#fff"
          d="M24 31.5c.5 0 3.4 1.6 4.2 2.2.8.6.5 1.3-.2 1.8l-3 2.3c-.6.5-1.4.5-2 0l-3-2.3c-.7-.5-1-1.2-.2-1.8.8-.6 3.7-2.2 4.2-2.2Zm-8.6-15.6 4.1.7c1.2.2 2.4 0 3.5-.4l1-.4 1 .4c1.1.4 2.3.6 3.5.4l4.1-.7 1.6 2.2-2.6 3.3c-.5.6-.6 1.5-.2 2.2l1.8 3.2c.4.7.2 1.5-.4 2l-3.3 2.5c-.7.5-1.6.3-2.1-.3L24 30l-3.2-2.2c-.5.6-1.4.8-2.1.3l-3.3-2.5c-.6-.5-.8-1.3-.4-2l1.8-3.2c.4-.7.3-1.6-.2-2.2l-2.6-3.3Z"
        />
      </svg>
    );
  if (browser === "firefox")
    return (
      <svg {...common}>
        <defs>
          <radialGradient id={`${id}a`} cx="0.75" cy="0.2" r="1">
            <stop offset="0" stopColor="#FFE226" />
            <stop offset="0.35" stopColor="#FF7139" />
            <stop offset="0.7" stopColor="#E31587" />
            <stop offset="1" stopColor="#9059FF" />
          </radialGradient>
          <radialGradient id={`${id}b`} cx="0.45" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#9059FF" />
            <stop offset="1" stopColor="#592ACB" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="25" r="19.5" fill={`url(#${id}a)`} />
        <circle cx="25" cy="26" r="11.5" fill={`url(#${id}b)`} />
        <path
          fill="#FFBD4F"
          d="M7 15.5c-2.3 4.6-2.8 10.4-.6 15.8 3 7.4 10.3 12.7 18.8 12.7 7.8 0 14.6-4.5 17.9-11-3 3.4-7.6 5.4-12.4 5-7-.6-12.2-6.4-12-13.3.1-1.8.6-3.4 1.4-4.9-3.4.7-6.7-.3-8.4-2.3-1.2 1.2-3.2-.5-4.7-2Z"
        />
      </svg>
    );
  return null;
}
