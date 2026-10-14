import { REGION_CODES, REGIONS, type SearchRegionCode } from "@/lib/seo";
const flags = { US: "🇺🇸", JP: "🇯🇵", ES: "🇪🇸", BR: "🇧🇷" };
export function RegionSelect({
  value,
  onChange,
}: {
  value: SearchRegionCode;
  onChange: (region: SearchRegionCode) => void;
}) {
  return (
    <div className="regionSwitch" role="group" aria-label="选择地区">
      {REGION_CODES.map((region) => (
        <button
          key={region}
          className={value === region ? "regionButton active" : "regionButton"}
          aria-pressed={value === region}
          onClick={() => onChange(region)}
          type="button"
        >
          <span>{flags[region]}</span>
          {REGIONS[region].label}
        </button>
      ))}
    </div>
  );
}
