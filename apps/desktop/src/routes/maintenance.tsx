import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/maintenance")({
  beforeLoad: () => {
    throw redirect({ to: "/car" });
  },
});
