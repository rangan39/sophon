import { SquareSigma } from "lucide-react";
import { sophonBrandMark, sophonChromeSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

export default function Loading() {
  return (
    <main className={cn(sophonGridSurface, "grid h-svh overflow-hidden bg-background text-foreground grid-cols-[380px_minmax(0,1fr)] max-[1024px]:grid-cols-1")}>
      <aside className={cn(sophonChromeSurface, "min-h-0 border-r max-[1024px]:hidden")} />
      <section className="grid min-h-0 grid-rows-[58px_minmax(0,1fr)] bg-background">
        <header className={cn(sophonChromeSurface, "flex items-center justify-between border-b px-4 py-2.5")}>
          <div className="h-6 w-40 rounded bg-[#a6acb2]/20" />
          <div className="h-9 w-24 rounded-md bg-[#a6acb2]/20" />
        </header>
        <div className={cn(sophonGridSurface, "flex h-full items-center justify-center px-7 text-center text-muted-foreground")}>
          <div className="flex flex-col items-center rounded-lg border border-[#d5d9dd] bg-white/95 px-8 py-7 shadow-[0_12px_36px_rgb(166_172_178/.16)]">
            <div className={cn(sophonBrandMark, "grid size-16 place-items-center rounded-md border")}>
              <SquareSigma className="size-9 text-primary-foreground" />
            </div>
            <p className="mt-4 text-sm">Loading Sophon...</p>
          </div>
        </div>
      </section>
    </main>
  );
}
