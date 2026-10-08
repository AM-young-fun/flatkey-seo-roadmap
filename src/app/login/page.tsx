import type { Metadata } from "next";
import { isAuthEnabled } from "@/lib/auth";

export const metadata: Metadata = {
  title: "登录 - SEO Rank Monitor"
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith("/") ? params.next : "/";
  const hasError = params.error === "1";

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <div>
          <p className="eyebrow">SEO Rank Monitor</p>
          <h1>登录</h1>
        </div>
        <form action={`/api/auth/login?next=${encodeURIComponent(nextPath)}`} className="loginForm" method="post">
          <label>
            <span>密码</span>
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          {hasError ? <p className="loginError">密码错误</p> : null}
          {!isAuthEnabled() ? <p className="loginHint">当前未设置 LOGIN_PWD，登录保护未启用。</p> : null}
          <button className="primaryButton" type="submit">
            登录
          </button>
        </form>
      </section>
    </main>
  );
}
