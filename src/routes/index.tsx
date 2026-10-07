import { createFileRoute } from "@tanstack/react-router";
import { GraphBuilder } from "@/components/GraphBuilder";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "uqsim Graph Builder" },
      { name: "description", content: "Visually build uqsim service graphs and export machines, graph and links JSON." },
      { property: "og:title", content: "uqsim Graph Builder" },
      { property: "og:description", content: "Visually build uqsim service graphs and export JSON configs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return <GraphBuilder />;
}
