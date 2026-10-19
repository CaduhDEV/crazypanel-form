import { DotGrid } from "@/components/dot-grid";
import { Wizard } from "@/components/wizard";

export default function Page() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_25%,#181238_0%,#070712_80%)] px-4 py-10">
      <DotGrid />
      <Wizard />
    </main>
  );
}
