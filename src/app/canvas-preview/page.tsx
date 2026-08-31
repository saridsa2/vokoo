// Scratch route for evaluating the imported stackplane editor. Outside the
// (console) group so the console shell and its nav do not wrap it.
"use client";

import "@/recovered-editor/styles.css";

import dynamic from "next/dynamic";

const RecoveredEditorHost = dynamic(
    () => import("@/components/stackplane/recovered-editor-host").then((module) => module.RecoveredEditorHost),
    { ssr: false },
);

export default function CanvasPreviewPage() {
    return <RecoveredEditorHost />;
}
