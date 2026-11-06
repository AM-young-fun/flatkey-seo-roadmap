"use client";

import { useEffect, useState } from "react";
import { seoCountry, type SeoCountry } from "@/lib/seo";

export function useSeoCountry(initial: SeoCountry = "all") {
  const [country, setCountry] = useState(initial);
  useEffect(() => {
    const read = () => setCountry(seoCountry(new URLSearchParams(location.search).get("country")));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return [country, changeCountry] as const;
}

function changeCountry(value: string) {
  const country = seoCountry(value);
  const params = new URLSearchParams(location.search);
  if (country === "all") params.delete("country");
  else params.set("country", country);
  const url = location.pathname + (params.size ? "?" + params : "") + location.hash;
  if (url === location.pathname + location.search + location.hash) return;
  history.pushState(null, "", url);
  dispatchEvent(new PopStateEvent("popstate"));
}
