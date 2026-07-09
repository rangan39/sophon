"use client";

import dynamic from "next/dynamic";
import Loading from "@/app/loading";

const SophonWorkbench = dynamic(
  () => import("@/components/sophon-workbench").then((module) => module.SophonWorkbench),
  {
    loading: Loading,
    ssr: false
  }
);

export function WorkbenchClient() {
  return <SophonWorkbench />;
}
