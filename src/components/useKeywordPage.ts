"use client";
import { useEffect, useState, useCallback } from "react";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import type { DashboardResponse } from "@/lib/types";
import type { KeywordOkrResponse } from "@/lib/keyword-okr";
type KeywordPage = DashboardResponse & {total:number;page:number;pageSize:10;okr:KeywordOkrResponse};
export function useKeywordPage(filters:{pool:string;country:string;site:string;rank:string;pageStatus:string;q:string}) {
  const filterKey = new URLSearchParams(filters).toString();
  const [pagination,setPagination] = useState({filterKey,page:1}), [revision,setRevision] = useState(0);
  const page = pagination.filterKey === filterKey ? pagination.page : 1;
  const url = `/api/keywords/details?${filterKey}&page=${page}`;
  const [state,setState] = useState<{url:string;data:KeywordPage} | null>(null), [error,setError] = useState<string|null>(null);
  const refresh = useCallback(() => setRevision(value=>value+1),[]);
  useEffect(() => {
    let disposed = false;
    let pendingTimer:ReturnType<typeof setTimeout>;
    const read = async (force = false) => {
      try {const data = await clientReadCache.read<KeywordPage>(url,force || revision > 0);if(!disposed){setState({url,data});setError(null);if(data.displaySnapshot?.pending)pendingTimer=setTimeout(()=>void read(true),5000);}}
      catch(failure) {if(disposed)return;if(failure instanceof ClientReadError && failure.status === 401){clientReadCache.clear();window.location.assign("/login");return;}setError("关键词读取失败，请重试");}
    };
    const delay = setTimeout(()=>void read(),filters.q ? 250 : 0);
    const updated = () => void read(true);
    window.addEventListener("seo-rankings-updated",updated);
    return () => {disposed=true;clearTimeout(delay);clearTimeout(pendingTimer);window.removeEventListener("seo-rankings-updated",updated);};
  },[url,revision,filters.q]);
  const data = state?.url === url ? state.data : clientReadCache.peek<KeywordPage>(url);
  return {data,error,loading:!data&&!error,refresh,page,setPage:(value:number)=>setPagination({filterKey,page:value})};
}
