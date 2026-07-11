import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "sisiGo",
    short_name: "sisiGo",
    description: "Build habits that stick. One tap, every day.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0f",
    theme_color: "#6366f1",
    categories: ["health", "lifestyle", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Today's habits",
        url: "/dashboard",
        description: "See and complete today's habits",
      },
      {
        name: "Journal",
        url: "/journal",
        description: "Write today's reflection",
      },
    ],
  };
}
