import NextLink from "next/link";
import type { ComponentPropsWithRef } from "react";
import { externalLinkRel } from "@/lib/public-link-policy";
export { useLinkStatus } from "next/link";
export type { LinkProps } from "next/link";

export default function SeoLink({ href, as, rel, ...props }: ComponentPropsWithRef<typeof NextLink>) {
  return <NextLink {...props} href={href} as={as} rel={externalLinkRel(as ?? href, rel)} />;
}
