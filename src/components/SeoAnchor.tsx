import type { ComponentPropsWithRef } from "react";
import { externalLinkRel } from "@/lib/public-link-policy";

export function SeoAnchor({ href, rel, ...props }: ComponentPropsWithRef<"a">) {
  return <a {...props} href={href} rel={externalLinkRel(href, rel)} />;
}
