import type { AhrefsVolumeResult } from "@/lib/types";
import { demoVolumeFor, REGIONS, type SearchRegionCode } from "@/lib/seo";
import { envBool, envInt, envString } from "@/lib/env";

type JsonRecord = Record<string, unknown>;

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function findVolume(value: unknown): number | null {
  const direct = numericValue(value);
  if (direct !== null) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVolume(item);
      if (found !== null) {
        return found;
      }
    }
  }

  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    const preferredKeys = ["volume", "search_volume", "searchVolume", "monthly_volume"];

    for (const key of preferredKeys) {
      if (key in record) {
        const found = numericValue(record[key]);
        if (found !== null) {
          return found;
        }
      }
    }

    for (const nested of Object.values(record)) {
      const found = findVolume(nested);
      if (found !== null) {
        return found;
      }
    }
  }

  return null;
}

function buildAhrefsUrl(keyword: string, region: SearchRegionCode): string | null {
  const template = envString("AHREFS_API_URL_TEMPLATE");
  if (!template) {
    return null;
  }

  const country = REGIONS[region].ahrefsCountry;
  const rawUrl = template
    .replaceAll("{keyword}", encodeURIComponent(keyword))
    .replaceAll("{keywords}", encodeURIComponent(keyword))
    .replaceAll("{country}", encodeURIComponent(country))
    .replaceAll("{region}", encodeURIComponent(region.toLowerCase()));

  const url = new URL(rawUrl);

  if (!url.searchParams.has("select")) {
    url.searchParams.set("select", "keyword,volume");
  }

  return url.toString();
}

export async function fetchAhrefsVolume(
  keyword: string,
  region: SearchRegionCode
): Promise<AhrefsVolumeResult> {
  const token = envString("AHREFS_API_TOKEN");
  const disabled = envBool("DISABLE_EXTERNAL_FETCH", false);
  const url = buildAhrefsUrl(keyword, region);

  if (disabled || !token || !url) {
    return {
      volume: demoVolumeFor(keyword, region),
      source: "demo"
    };
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(envInt("AHREFS_TIMEOUT_MS", 15000)),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      detail
        ? `Ahrefs provider failed with ${response.status}: ${detail}`
        : `Ahrefs provider failed with ${response.status}`
    );
  }

  const payload = (await response.json()) as unknown;
  const volume = findVolume(payload);

  return {
    volume: volume ?? demoVolumeFor(keyword, region),
    source: volume === null ? "demo" : "ahrefs"
  };
}
