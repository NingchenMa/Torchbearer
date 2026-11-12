// The screen for something the signed-in person isn't allowed to use. Plain, with a way back.
import Link from "next/link";

export default function NoAccess({ message, backHref = "/vault", backLabel = "← Back to Workflows" }: { message: string; backHref?: string; backLabel?: string }) {
  return (
    <div className="mx-auto my-14 max-w-[520px] rounded-md border border-line bg-white px-7 py-9 text-center shadow-[0_4px_14px_rgba(16,24,40,.04)]">
      <div className="mx-auto mb-3.5 grid h-12 w-12 place-items-center rounded-full bg-indigo-soft text-indigo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
      </div>
      <p className="mb-4 text-[16px] text-[#1f2d3d]">{message}</p>
      <Link prefetch={false} href={backHref} className="btn">{backLabel}</Link>
    </div>
  );
}
