"use client";

import dynamic from "next/dynamic";

const SophonWorkbench = dynamic(
  () => import("@/components/sophon-workbench").then((module) => module.SophonWorkbench),
  {
    ssr: false
  }
);

export default function Home() {
  return <SophonWorkbench />;
}
