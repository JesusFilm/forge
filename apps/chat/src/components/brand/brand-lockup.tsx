// The brand lockup: the official Jesus Film Project flag mark (jfp-sign.svg,
// inlined so it needs no network request) paired with the jesusfilm.ai
// wordmark in Inter Tight 500. Height is the anchor — width follows the
// intrinsic 49:36 ratio, never distorted. Canonical source SVGs live in
// public/brand/ (available by URL for favicon/OG later); the mark is inlined
// here so it needs no request and can be themed.

export function BrandLockup({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        viewBox="0 0 49 36"
        height={22}
        width={(22 * 49) / 36}
        fill="none"
        aria-hidden="true"
        className="block shrink-0"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M45.854 -0.000301361H2.34C1.048 -0.000301361 0 1.0467 0 2.3397V20.2427C0 21.2917 0.699 22.2137 1.709 22.4957L47.072 35.2077C47.636 35.3657 48.194 34.9417 48.194 34.3567V2.3397C48.194 1.0467 47.147 -0.000301361 45.854 -0.000301361Z"
          fill="#EF3340"
        />
      </svg>
      {wordmark ? (
        <span className="font-body text-[17px] font-medium tracking-[-0.005em] text-linen">
          jesusfilm.ai
        </span>
      ) : null}
    </span>
  )
}
