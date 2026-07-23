import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

/** Primary lab surfaces first — process evidence only. */
const PATHS = [
  "/",
  "/showcase",
  "/session",
  "/shadow-lab",
  "/control-room",
  "/registry",
  "/mcp",
  "/dossier",
  "/safety-card",
  "/verify",
  "/lineage",
  "/proof-capsule",
  "/trust",
  "/experiments/new",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PATHS.map((path, index) => ({
    url: `${SITE_ORIGIN}${path === "/" ? "" : path}`,
    lastModified,
    changeFrequency: path === "/" || path === "/showcase" ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "/showcase" ? 0.95 : Math.max(0.5, 0.9 - index * 0.03),
  }));
}
