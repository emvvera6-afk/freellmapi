import type { SVGProps } from 'react'

/**
 * Commercial-facing brand. Runtime/package/env identifiers intentionally keep
 * their FreeLLMAPI names so existing installs and client configurations remain
 * compatible during the rebrand.
 */
export const BRAND_NAME = 'Muxora'
export const BRAND_TAGLINE = 'One route. Every model. Your team in control.'
export const ENGINE_NAME = 'FreeLLMAPI'

export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <rect width="32" height="32" rx="9" fill="url(#muxora-mark-bg)" />
      <path
        d="M8 10h4.2L16 16l3.8-6H24M8 22h4.2L16 16l3.8 6H24"
        stroke="white"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.35" fill="white" />
      <defs>
        <linearGradient id="muxora-mark-bg" x1="4" y1="2" x2="29" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
    </svg>
  )
}
