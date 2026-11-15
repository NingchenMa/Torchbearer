// The screen for something the signed-in person isn't allowed to use. Plain, with a way back.
import Link from "next/link";
import { Lock } from "lucide-react";

export default function NoAccess({ message, backHref = "/vault", backLabel = "← Back to Workflows" }: { message: string; backHref?: string; backLabel?: string }) {
  return (
    <div className="mx-auto my-14 max-w-[520px] rounded-lg border border-line bg-white px-7 py-10 text-center shadow-[0_1px_2px_rgba(58,11,20,.04)]">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-cream text-crimson">
        <Lock size={22} aria-hidden="true" />
      </div>
      <p className="mb-5 font-display text-[22px] leading-snug text-ink [text-wrap:balance]">{message}</p>
      <Link prefetch={false} href={backHref} className="tb-btn-line h-10">{backLabel}</Link>
    </div>
  );
}
