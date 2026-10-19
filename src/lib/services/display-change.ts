import { after } from "next/server";
import { invalidateDisplaySnapshots } from "./display-snapshots";
import { refreshDisplayViews } from "./display-views";
export async function displayDataChanged() {
  try { await invalidateDisplaySnapshots(); } catch { console.error("Display invalidation deferred"); }
  try { after(async () => { try { await refreshDisplayViews(Date.now()+45_000); } catch { console.error("Display refresh deferred"); } }); }
  catch { console.error("Display refresh left for coordinator"); }
}
